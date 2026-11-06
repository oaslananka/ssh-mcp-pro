import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { loadRemoteConfig } from "../../src/remote/config.js";
import { issueAccessToken, loadJwtKeyPair, nowIso } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import type { RemoteScope } from "../../src/remote/types.js";

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

async function issueOwnerToken(
  harness: Harness,
  githubId: string,
  scopes: RemoteScope[],
): Promise<string> {
  const keyPair = await loadJwtKeyPair(harness.config.jwtSigningKeyPath);
  const result = await issueAccessToken(
    harness.config,
    keyPair,
    { id: "github:" + githubId, githubId, githubLogin: "owner-" + githubId },
    scopes,
  );
  return result.token;
}

async function invoke(
  harness: Harness,
  method: string,
  params: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = harness.server.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    throw new Error("Remote MCP boundary server is not listening on loopback");
  }
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 500,
              body: JSON.parse(text) as Record<string, unknown>,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify({ jsonrpc: "2.0", id: 11, method, params }));
  });
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

  test("isolates two bearer-token tenants across MCP lists, agent management and audits", async () => {
    const harness = await startHarness();
    const policy = createAgentPolicy("read-only");
    const createdAt = nowIso();
    const owners = [
      { githubId: "101", userId: "github:101", agentId: "agt_first", eventId: "aud_first" },
      { githubId: "202", userId: "github:202", agentId: "agt_second", eventId: "aud_second" },
    ];

    for (const owner of owners) {
      harness.controlPlane.store.insertAgent({
        id: owner.agentId,
        userId: owner.userId,
        alias: "same-alias",
        status: "offline",
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt,
        updatedAt: createdAt,
      });
      harness.controlPlane.store.insertAudit({
        id: owner.eventId,
        userId: owner.userId,
        agentId: owner.agentId,
        eventType: "tenant_test",
        severity: "info",
        metadata: { tenant: owner.githubId },
        createdAt,
      });
    }

    const scopes: RemoteScope[] = ["hosts:read", "agents:read", "agents:admin"];
    const tokens = await Promise.all(
      owners.map((owner) => issueOwnerToken(harness, owner.githubId, scopes)),
    );

    for (const [index, owner] of owners.entries()) {
      const token = tokens[index]!;
      const other = owners[1 - index]!;

      for (const [tool, key] of [
        ["list_hosts", "hosts"],
        ["list_agents", "agents"],
      ] as const) {
        const response = await invoke(harness, "tools/call", { name: tool, arguments: {} }, token);
        expect(response.status).toBe(200);
        const data = (response.body.result as { structuredContent: Record<string, unknown> })
          .structuredContent;
        const devices = data[key] as Array<{ id: string; alias: string }>;
        expect(devices).toHaveLength(1);
        expect(devices[0]).toMatchObject({ id: owner.agentId, alias: "same-alias" });
        expect(JSON.stringify(devices)).not.toContain(other.agentId);
      }

      const audit = await invoke(
        harness,
        "tools/call",
        { name: "get_audit_events", arguments: {} },
        token,
      );
      expect(audit.status).toBe(200);
      const events = (audit.body.result as { structuredContent: { events: Array<{ id: string }> } })
        .structuredContent.events;
      expect(events.map((event) => event.id)).toContain(owner.eventId);
      expect(events.map((event) => event.id)).not.toContain(other.eventId);

      for (const tool of ["get_agent_install_command", "update_agent_policy", "revoke_agent"]) {
        const foreign = await invoke(
          harness,
          "tools/call",
          {
            name: tool,
            arguments: {
              agent_id_or_alias: other.agentId,
              ...(tool === "update_agent_policy" ? { policy: { profile: "full-admin" } } : {}),
            },
          },
          token,
        );
        expect(foreign.status).toBe(200);
        expect(foreign.body.error).toMatchObject({
          data: { code: "AGENT_NOT_FOUND" },
        });
      }
      expect(harness.controlPlane.store.getAgent(other.agentId)?.status).toBe("offline");
    }
  });

  test("auto-negotiating SDK clients discover modern remote MCP without privilege escalation", async () => {
    const harness = await startHarness();
    const token = await issueToken(harness, "hosts:read");
    const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
      requestInit: { headers: { authorization: "Bearer " + token } },
    });
    const client = new Client(
      { name: "remote-auto-acceptance", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      expect(tools).toContain("list_hosts");
      expect(tools).not.toContain("run_shell");
      const status = await client.callTool({ name: "list_hosts", arguments: {} });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({ hosts: [] });
    } finally {
      await client.close();
    }
  });

  test("pinned 2026-07-28 and explicitly legacy clients share scoped tool behavior", async () => {
    const harness = await startHarness();
    const token = await issueToken(harness, "hosts:read");
    for (const [name, mode, expected] of [
      ["remote-modern-pinned", { pin: "2026-07-28" as const }, "modern"],
      ["remote-legacy-explicit", "legacy" as const, "legacy"],
    ] as const) {
      const client = new Client({ name, version: "1.0.0" }, { versionNegotiation: { mode } });
      const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
        requestInit: { headers: { authorization: "Bearer " + token } },
      });
      try {
        await client.connect(transport);
        expect(client.getProtocolEra()).toBe(expected);
        const listed = (await client.listTools()).tools.map((tool) => tool.name);
        expect(listed).toContain("list_hosts");
        expect(listed).not.toContain("run_shell");
        const result = await client.callTool({ name: "list_hosts", arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ hosts: [] });
      } finally {
        await client.close();
      }
    }
  });

  test("modern SDK clients cannot read or revoke another owner's agents", async () => {
    const harness = await startHarness();
    const policy = createAgentPolicy("read-only");
    const createdAt = nowIso();
    const agents = [
      { id: "agt_modern_first", userId: "github:301" },
      { id: "agt_modern_second", userId: "github:302" },
    ] as const;
    for (const agent of agents) {
      harness.controlPlane.store.insertAgent({
        id: agent.id,
        userId: agent.userId,
        alias: "shared-alias",
        status: "offline",
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt,
        updatedAt: createdAt,
      });
    }
    for (const [index, agent] of agents.entries()) {
      const other = agents[1 - index]!;
      const token = await issueOwnerToken(harness, agent.userId.slice("github:".length), [
        "hosts:read",
        "agents:read",
        "agents:admin",
      ]);
      const client = new Client(
        { name: "modern-tenant-" + index, version: "1.0.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
        requestInit: { headers: { authorization: "Bearer " + token } },
      });
      try {
        await client.connect(transport);
        expect(client.getProtocolEra()).toBe("modern");
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        expect(names).toContain("list_agents");
        expect(names).toContain("revoke_agent");
        expect(names).not.toContain("run_shell");
        const own = await client.callTool({ name: "list_agents", arguments: {} });
        expect(own.structuredContent).toMatchObject({
          agents: [{ id: agent.id, alias: "shared-alias" }],
        });
        expect(JSON.stringify(own.structuredContent)).not.toContain(other.id);

        const denied = await client
          .callTool({ name: "revoke_agent", arguments: { agent_id_or_alias: other.id } })
          .then(
            (result) => result.isError === true,
            () => true,
          );
        expect(denied).toBe(true);
        expect(harness.controlPlane.store.getAgent(other.id)?.status).toBe("offline");
      } finally {
        await client.close();
      }
    }
  });

  test("rejects forged modern per-request protocol headers instead of silently downgrading", async () => {
    const harness = await startHarness();
    const token = await issueToken(harness, "hosts:read");
    let corrupted = false;
    const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
      requestInit: { headers: { authorization: "Bearer " + token } },
      fetch: (input, init) => {
        // This test transport only makes requests to its own disposable
        // loopback server. Never forward an arbitrary SDK-supplied URL.
        const source = input instanceof Request ? input.url : String(input);
        if (source !== harness.endpoint) {
          throw new Error("Unexpected transport URL in local MCP boundary test");
        }
        const request = new Request(harness.endpoint, input instanceof Request ? input : init);
        if (request.method === "POST" && request.headers.get("mcp-method") === "tools/list") {
          // The body still carries the SDK's authenticated modern version.
          // A forged 2025 header must fail rather than falling back to initialize.
          request.headers.set("mcp-protocol-version", "2025-11-25");
          corrupted = true;
        }
        return fetch(request);
      },
    });
    const client = new Client(
      { name: "remote-header-mismatch", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");
      await expect(client.listTools()).rejects.toThrow();
      expect(corrupted).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("never downgrades an unauthenticated modern discovery request to legacy", async () => {
    const harness = await startHarness();
    const client = new Client(
      { name: "remote-unauthorized-modern", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint));
    try {
      await expect(client.connect(transport)).rejects.toThrow();
    } finally {
      await client.close();
    }
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
