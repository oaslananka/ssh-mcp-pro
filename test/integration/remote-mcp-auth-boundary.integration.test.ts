import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { loadRemoteConfig } from "../../src/remote/config.js";
import { issueAccessToken, loadJwtKeyPair } from "../../src/remote/crypto.js";

type Harness = {
  endpoint: string;
  config: ReturnType<typeof loadRemoteConfig>;
  controlPlane: RemoteControlPlane;
  server: Server;
  directory: string;
};

const harnesses: Harness[] = [];

async function startHarness(): Promise<Harness> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-remote-mcp-http-"));
  const publicBaseUrl = "http://127.0.0.1:3000";
  const config = {
    ...loadRemoteConfig(),
    enabled: true,
    publicBaseUrl,
    mcpResourceUrl: publicBaseUrl + "/mcp",
    databaseUrl: "file:" + path.join(directory, "remote.db"),
    controlPlaneSigningKeyPath: path.join(directory, "control-plane.json"),
    jwtSigningKeyPath: path.join(directory, "jwt.json"),
  };
  let controlPlane: RemoteControlPlane | undefined;
  let server: Server | undefined;
  try {
    controlPlane = new RemoteControlPlane(config);
    await controlPlane.initialize();
    server = createServer((req, res) => {
      void controlPlane!
        .handleHttp(req, res, new URL(req.url ?? "/", publicBaseUrl).pathname)
        .then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404);
            res.end();
          }
        })
        .catch(() => {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Remote MCP test server did not bind");
    }
    const harness = {
      endpoint: "http://127.0.0.1:" + address.port + "/mcp",
      config,
      controlPlane,
      server,
      directory,
    };
    harnesses.push(harness);
    return harness;
  } catch (error) {
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    controlPlane?.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await new Promise<void>((resolve) => harness.server.close(() => resolve()));
    harness.controlPlane.close();
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

async function issueToken(harness: Harness, scope: "hosts:read" | "shell:exec") {
  const keyPair = await loadJwtKeyPair(harness.config.jwtSigningKeyPath);
  const result = await issueAccessToken(
    harness.config,
    keyPair,
    { id: "github:1", githubId: "1", githubLogin: "boundary-test" },
    [scope],
  );
  return result.token;
}

async function invoke(
  harness: Harness,
  method: string,
  params: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(harness.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 11, method, params }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("remote-agent MCP real HTTP authorization boundary", () => {
  test("rejects missing tokens and exposes only tools granted by each JWT scope", async () => {
    const harness = await startHarness();
    const unauthorized = await invoke(harness, "tools/list", {});
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body).toMatchObject({ error: "Missing or invalid bearer token" });

    const hostsToken = await issueToken(harness, "hosts:read");
    const shellToken = await issueToken(harness, "shell:exec");

    const hostsList = await invoke(harness, "tools/list", {}, hostsToken);
    const shellList = await invoke(harness, "tools/list", {}, shellToken);
    expect(hostsList.status).toBe(200);
    expect(shellList.status).toBe(200);

    const hostsNames = (hostsList.body.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name,
    );
    const shellNames = (shellList.body.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name,
    );

    expect(hostsNames).toContain("list_hosts");
    expect(hostsNames).not.toContain("run_shell");
    expect(shellNames).toContain("run_shell");
    expect(shellNames).not.toContain("list_hosts");

    const hostsCall = await invoke(
      harness,
      "tools/call",
      { name: "list_hosts", arguments: {} },
      hostsToken,
    );
    expect(hostsCall.status).toBe(200);
    expect(hostsCall.body).toMatchObject({
      result: { structuredContent: { hosts: [] } },
    });
  });

  test("preserves the explicit 2025-era initialization contract", async () => {
    const harness = await startHarness();
    const token = await issueToken(harness, "hosts:read");
    const reply = await invoke(
      harness,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "legacy-http-boundary-test", version: "1.0.0" },
      },
      token,
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "sshautomator-remote-agent" },
      },
    });
  });
});
