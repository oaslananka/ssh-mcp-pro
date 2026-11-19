import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createContainer, type AppContainer } from "../../src/container.js";
import { createProcessService, type ProcessService } from "../../src/process.js";
import { withRetry } from "../../src/retry.js";
import { SSHMCPError } from "../../src/types.js";

const TEST_SSH_HOST = process.env.TEST_SSH_HOST || "localhost";
const TEST_SSH_PORT = parseInt(process.env.TEST_SSH_PORT || "2222", 10);
const TEST_SSH_USER = process.env.TEST_SSH_USER || "testuser";
const TEST_SSH_PASS = process.env.TEST_SSH_PASS || "testpass";
const RUN_INTEGRATION = process.env.RUN_SSH_INTEGRATION === "1";
const integrationDescribe = RUN_INTEGRATION ? describe : describe.skip;

integrationDescribe("SSH integration tests", () => {
  let container: AppContainer;
  let processService: ProcessService;
  let sessionId = "";

  beforeAll(async () => {
    container = createContainer({
      security: {
        allowRootLogin: true,
        hostKeyPolicy: "insecure",
        knownHostsPath: "",
        allowedCiphers: [],
      },
      policy: {
        mode: "enforce",
        allowRawSudo: true,
        allowDestructiveCommands: true,
        allowDestructiveFs: true,
        allowRootLogin: true,
        allowedHosts: [],
        commandAllow: [],
        commandDeny: [],
        pathAllowPrefixes: ["/tmp"],
        pathDenyPrefixes: [],
        localPathAllowPrefixes: [os.tmpdir()],
        localPathDenyPrefixes: [],
        tunnelAllowBindHosts: ["127.0.0.1", "localhost", "::1"],
        tunnelDenyBindHosts: ["0.0.0.0", "::"],
        tunnelAllowRemoteHosts: [],
        tunnelDenyRemoteHosts: [],
        tunnelAllowPorts: [],
        tunnelDenyPorts: [],
      },
    });
    processService = createProcessService({
      sessionManager: container.sessionManager,
      config: container.config.getAll(),
      policy: container.policy,
    });

    const session = await container.sessionManager.openSession({
      host: TEST_SSH_HOST,
      port: TEST_SSH_PORT,
      username: TEST_SSH_USER,
      password: TEST_SSH_PASS,
      auth: "password",
      hostKeyPolicy: "insecure",
    });
    sessionId = session.sessionId;
  });

  afterAll(async () => {
    if (!container) {
      return;
    }

    if (sessionId) {
      await container.sessionManager.closeSession(sessionId);
    }

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("returns a structured auth failure for a bad password", async () => {
    const isolated = createContainer();

    await expect(
      isolated.sessionManager.openSession({
        host: TEST_SSH_HOST,
        port: TEST_SSH_PORT,
        username: TEST_SSH_USER,
        password: "definitely-wrong-password",
        auth: "password",
        hostKeyPolicy: "insecure",
      }),
    ).rejects.toMatchObject({
      code: "EAUTH",
    });

    isolated.rateLimiter.destroy();
    await isolated.sessionManager.destroy();
  });

  test("supports retrying a timed-out remote command until it succeeds", async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts++;
        const command = attempts === 1 ? "sleep 1; echo first-attempt" : "echo retry-success";

        return processService.execCommand(
          sessionId,
          command,
          undefined,
          undefined,
          attempts === 1 ? 250 : 2_000,
        );
      },
      {
        maxAttempts: 2,
        initialDelayMs: 10,
        maxDelayMs: 10,
        backoffMultiplier: 1,
        jitter: false,
        isRetryable: (error) => error instanceof SSHMCPError && error.code === "ETIMEOUT",
      },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.result?.stdout).toContain("retry-success");
  });

  // The default SSH fixture disables TCP forwarding. Enable this test only with an isolated, forwarding-enabled fixture.
  test.skipIf(process.env.RUN_SSH_TUNNEL_INTEGRATION !== "1")(
    "opens real SSH local forwarding and releases the port with a connected TCP client",
    async () => {
      const candidate = net.createServer();
      await new Promise<void>((resolve) => candidate.listen(0, "127.0.0.1", resolve));
      const address = candidate.address();
      if (!address || typeof address === "string") throw new Error("No available loopback port");
      await new Promise<void>((resolve) => candidate.close(() => resolve()));

      const forward = await container.tunnelService.createLocalForward(
        sessionId,
        address.port,
        "127.0.0.1",
        TEST_SSH_PORT,
      );
      const client = net.connect(address.port, "127.0.0.1");
      try {
        await new Promise<void>((resolve, reject) => {
          client.once("connect", resolve);
          client.once("error", reject);
        });
        const received = await Promise.race([
          new Promise<string>((resolve, reject) => {
            client.once("data", (data: Buffer) => resolve(data.toString("utf8")));
            client.once("error", reject);
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("SSH banner not received")), 3_000).unref();
          }),
        ]);
        expect(received).toContain("SSH-2.0");
        await expect(container.tunnelService.closeTunnel(forward.id)).resolves.toBe(true);
        await vi.waitFor(() => expect(client.destroyed).toBe(true));
        const reuse = net.createServer();
        try {
          await new Promise<void>((resolve) => reuse.listen(address.port, "127.0.0.1", resolve));
          expect(reuse.listening).toBe(true);
        } finally {
          await new Promise<void>((resolve) => reuse.close(() => resolve()));
        }
      } finally {
        client.destroy();
        await container.tunnelService.closeTunnel(forward.id);
      }
    },
  );

  // Opt-in only: the standard fixture deliberately disables SSH remote forwarding.
  test.skipIf(process.env.RUN_SSH_REMOTE_TUNNEL_INTEGRATION !== "1")(
    "closes actual remote SSH forwarding and releases the remote listener",
    async () => {
      const target = net.createServer();
      const connection = new Promise<net.Socket>((resolve) => target.once("connection", resolve));
      await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
      const address = target.address();
      if (!address || typeof address === "string") throw new Error("No local port");
      const remotePort = 39489;
      const session = container.sessionManager.getSession(sessionId);
      if (!session) throw new Error("Missing SSH session");
      let accepted: net.Socket | undefined;
      let tunnelId: string | undefined;
      let remoteProbe: Promise<unknown> | undefined;
      try {
        const tunnel = await container.tunnelService.createRemoteForward(
          sessionId,
          remotePort,
          "127.0.0.1",
          address.port,
        );
        tunnelId = tunnel.id;
        remoteProbe = session.ssh.execCommand(
          "bash -lc 'exec 3<>/dev/tcp/127.0.0.1/" + remotePort + "; printf probe >&3; sleep 3'",
        );
        accepted = await Promise.race([
          connection,
          remoteProbe.then((result) => {
            throw new Error(
              "Remote SSH probe returned before forwarding: " + JSON.stringify(result),
            );
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Remote forward never reached local listener")),
              5_000,
            ).unref(),
          ),
        ]);
        expect(accepted.destroyed).toBe(false);
        await expect(container.tunnelService.closeTunnel(tunnel.id)).resolves.toBe(true);
        await vi.waitFor(() => expect(accepted?.destroyed).toBe(true));
        const secondAttempt = await session.ssh.execCommand(
          "bash -lc 'exec 3<>/dev/tcp/127.0.0.1/" + remotePort + "'",
        );
        expect(secondAttempt.code).not.toBe(0);
      } finally {
        accepted?.destroy();
        if (tunnelId) await container.tunnelService.closeTunnel(tunnelId);
        await new Promise<void>((resolve) => target.close(() => resolve()));
        await remoteProbe?.catch(() => undefined);
      }
    },
    20_000,
  );

  test("fails host key verification when strict checking uses an empty known_hosts file", async () => {
    const isolated = createContainer();
    const knownHostsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-pro-known-hosts-"));
    const knownHostsPath = path.join(knownHostsDir, "known_hosts");
    fs.writeFileSync(knownHostsPath, "", "utf8");

    await expect(
      isolated.sessionManager.openSession({
        host: TEST_SSH_HOST,
        port: TEST_SSH_PORT,
        username: TEST_SSH_USER,
        password: TEST_SSH_PASS,
        auth: "password",
        strictHostKeyChecking: true,
        knownHostsPath,
      }),
    ).rejects.toThrow();

    fs.rmSync(knownHostsDir, { recursive: true, force: true });
    isolated.rateLimiter.destroy();
    await isolated.sessionManager.destroy();
  });
});
