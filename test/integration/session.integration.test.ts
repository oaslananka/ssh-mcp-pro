import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
