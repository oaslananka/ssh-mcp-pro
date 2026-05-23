import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { AgentExecutor, defaultHostMetadata } from "../../src/remote/agent-executor.js";
import {
  generateEd25519PemKeyPair,
  nowIso,
  randomToken,
  signEnvelope,
  verifyEnvelope,
} from "../../src/remote/crypto.js";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import type {
  ActionRequestEnvelope,
  AgentHelloEnvelope,
  AgentPolicy,
  PolicyUpdateEnvelope,
  RemoteConfig,
} from "../../src/remote/types.js";

interface RuntimeWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

type RuntimeWebSocketConstructor = new (url: string) => RuntimeWebSocket;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate port"));
        }
      });
    });
  });
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function wsCtor(): RuntimeWebSocketConstructor {
  const candidate = (globalThis as unknown as { WebSocket?: RuntimeWebSocketConstructor })
    .WebSocket;
  if (!candidate) {
    throw new Error("WebSocket is not available in this Node runtime");
  }
  return candidate;
}

async function jsonFetch(
  url: string,
  init: RequestInit & { expectedStatus?: number } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json()) as unknown;
  if (init.expectedStatus && response.status !== init.expectedStatus) {
    throw new Error(
      `Expected ${init.expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Expected JSON object");
  }
  return payload as Record<string, unknown>;
}

function config(baseUrl: string, dir: string): RemoteConfig {
  return {
    enabled: true,
    publicBaseUrl: baseUrl,
    mcpResourceUrl: `${baseUrl}/mcp`,
    databaseUrl: ":memory:",
    githubCallbackUrl: `${baseUrl}/oauth/callback/github`,
    allowAllUsers: true,
    allowedGitHubLogins: [],
    allowedGitHubIds: [],
    accessTokenTtlSeconds: 900,
    authCodeTtlSeconds: 300,
    enrollmentTokenTtlSeconds: 600,
    controlPlaneSigningKeyPath: path.join(dir, "control-plane.json"),
    jwtSigningKeyPath: path.join(dir, "jwt.json"),
    agentWsPath: "/api/agents/connect",
    maxActionTimeoutSeconds: 30,
    maxOutputBytes: 64_000,
    maxOAuthClients: 100,
  };
}

async function startHarness(): Promise<{
  baseUrl: string;
  controlPlane: RemoteControlPlane;
  server: ReturnType<typeof createServer>;
}> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-remote-"));
  const controlPlane = new RemoteControlPlane(config(baseUrl, dir));
  await controlPlane.initialize();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void controlPlane
      .handleHttp(req, res, new URL(req.url ?? "/", baseUrl).pathname)
      .catch((error) => {
        const status =
          error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
        const message =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : error instanceof Error
              ? error.message
              : String(error);
        const code =
          error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message, code }));
      });
  });
  server.on("upgrade", (req, socket, head) => {
    controlPlane.handleUpgrade(req, socket, head, new URL(req.url ?? "/", baseUrl).pathname);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { baseUrl, controlPlane, server };
}

async function issueTestAccessToken(baseUrl: string, scope: string): Promise<string> {
  const redirectUri = `${baseUrl}/callback-${randomToken(6)}`;
  const registration = await jsonFetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ client_name: "Integration Test", redirect_uris: [redirectUri] }),
    expectedStatus: 201,
  });
  const clientId = String(registration.client_id);
  const verifier = `test-verifier-${randomToken(12)}`;
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("code_challenge", challenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", randomToken(6));
  authorizeUrl.searchParams.set("resource", `${baseUrl}/mcp`);
  authorizeUrl.searchParams.set("scope", scope);
  const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
  const location = authorizeResponse.headers.get("location");
  expect(authorizeResponse.status).toBe(302);
  expect(location).toBeTruthy();
  const code = new URL(location ?? "").searchParams.get("code");
  expect(code).toBeTruthy();
  const token = await jsonFetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
    expectedStatus: 200,
  });
  return String(token.access_token);
}

function signedHello(
  agentId: string,
  privateKeyPem: string,
  policy: AgentPolicy,
  nonce = randomToken(16),
): AgentHelloEnvelope {
  const hello: AgentHelloEnvelope = {
    type: "agent.hello",
    agent_id: agentId,
    timestamp: nowIso(),
    nonce,
    capabilities: Object.entries(policy.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([capability]) => capability as AgentHelloEnvelope["capabilities"][number]),
    agent_version: "test",
    host: defaultHostMetadata(),
    signature: "",
  };
  hello.signature = signEnvelope(hello as unknown as Record<string, unknown>, privateKeyPem);
  return hello;
}

function connectAgent(
  websocketUrl: string,
  agentId: string,
  privateKeyPem: string,
  policy: AgentPolicy,
): Promise<RuntimeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new (wsCtor())(websocketUrl);
    const timeout = setTimeout(() => reject(new Error("agent connection timed out")), 5000);
    ws.onopen = () => {
      ws.send(JSON.stringify(signedHello(agentId, privateKeyPem, policy)));
    };
    ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (payload.type === "agent.ready") {
        clearTimeout(timeout);
        resolve(ws);
      } else if (payload.type === "error") {
        clearTimeout(timeout);
        reject(new Error(String(payload.code ?? payload.message)));
      }
    };
    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(new Error(String(error)));
    };
  });
}

describe("remote control plane and outbound agent flow", () => {
  let previousId: string | undefined;
  let previousLogin: string | undefined;

  beforeEach(() => {
    previousId = process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
    previousLogin = process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
    process.env.SSHAUTOMATOR_TEST_GITHUB_ID = "169144131";
    process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN = "oaslananka";
  });

  afterEach(() => {
    if (previousId === undefined) {
      delete process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
    } else {
      process.env.SSHAUTOMATOR_TEST_GITHUB_ID = previousId;
    }
    if (previousLogin === undefined) {
      delete process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
    } else {
      process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN = previousLogin;
    }
  });

  test("registers OAuth client, enrolls agent, enforces policy, updates policy, and revokes", async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-remote-"));
    const controlPlane = new RemoteControlPlane(config(baseUrl, dir));
    await controlPlane.initialize();
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void controlPlane
        .handleHttp(req, res, new URL(req.url ?? "/", baseUrl).pathname)
        .catch((error) => {
          const status =
            error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
          const message =
            error && typeof error === "object" && "message" in error
              ? String(error.message)
              : error instanceof Error
                ? error.message
                : String(error);
          const code =
            error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message, code }));
        });
    });
    server.on("upgrade", (req, socket, head) => {
      controlPlane.handleUpgrade(req, socket, head, new URL(req.url ?? "/", baseUrl).pathname);
    });

    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

    try {
      const redirectUri = `${baseUrl}/callback`;
      await jsonFetch(`${baseUrl}/oauth/register`, {
        method: "POST",
        body: JSON.stringify({ client_name: "bad", redirect_uris: ["javascript:alert(1)"] }),
        expectedStatus: 400,
      });
      const registration = await jsonFetch(`${baseUrl}/oauth/register`, {
        method: "POST",
        body: JSON.stringify({ client_name: "Integration Test", redirect_uris: [redirectUri] }),
        expectedStatus: 201,
      });
      const clientId = String(registration.client_id);
      const verifier = "test-verifier-1234567890";
      const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("code_challenge", challenge(verifier));
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("state", "state-1");
      authorizeUrl.searchParams.set("resource", `${baseUrl}/mcp`);
      authorizeUrl.searchParams.set(
        "scope",
        "hosts:read agents:read agents:admin status:read logs:read shell:exec sudo:exec",
      );
      const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
      const location = authorizeResponse.headers.get("location");
      expect(authorizeResponse.status).toBe(302);
      expect(location).toBeTruthy();
      const code = new URL(location ?? "").searchParams.get("code");
      expect(code).toBeTruthy();

      const token = await jsonFetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
        expectedStatus: 200,
      });
      const accessToken = String(token.access_token);
      await jsonFetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
        expectedStatus: 400,
      });

      const jwks = await jsonFetch(`${baseUrl}/oauth/jwks.json`, { expectedStatus: 200 });
      expect(Array.isArray(jwks.keys)).toBe(true);

      const unauthenticatedMcp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      expect(unauthenticatedMcp.status).toBe(401);
      expect(unauthenticatedMcp.headers.get("www-authenticate")).toContain(
        `${baseUrl}/.well-known/oauth-protected-resource`,
      );

      const enrollment = await jsonFetch(`${baseUrl}/api/agents/enrollment-tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ alias: "local-test", requested_profile: "read-only" }),
        expectedStatus: 201,
      });
      const enrollmentToken = String(enrollment.enrollment_token);
      const agentKeys = generateEd25519PemKeyPair();
      const enrollResponse = await jsonFetch(`${baseUrl}/api/agents/enroll`, {
        method: "POST",
        body: JSON.stringify({
          token: enrollmentToken,
          public_key: agentKeys.publicKeyPem,
          host: defaultHostMetadata(),
        }),
        expectedStatus: 200,
      });
      const agentId = String(enrollResponse.agent_id);
      const controlPlanePublicKey = String(enrollResponse.control_plane_public_key);
      let policy = enrollResponse.policy as AgentPolicy;
      const executor = new AgentExecutor(policy, agentKeys.privateKeyPem);

      await jsonFetch(`${baseUrl}/api/agents/enroll`, {
        method: "POST",
        body: JSON.stringify({
          token: enrollmentToken,
          public_key: agentKeys.publicKeyPem,
          host: defaultHostMetadata(),
        }),
        expectedStatus: 401,
      });

      await new Promise<void>((resolve, reject) => {
        const ws = new (wsCtor())(String(enrollResponse.websocket_url));
        const timeout = setTimeout(() => reject(new Error("agent connection timed out")), 5000);
        ws.onopen = () => {
          const hello: AgentHelloEnvelope = {
            type: "agent.hello",
            agent_id: agentId,
            timestamp: nowIso(),
            nonce: randomToken(16),
            capabilities: Object.entries(policy.capabilities)
              .filter(([, enabled]) => enabled)
              .map(([capability]) => capability as AgentHelloEnvelope["capabilities"][number]),
            agent_version: "test",
            host: defaultHostMetadata(),
            signature: "",
          };
          hello.signature = signEnvelope(
            hello as unknown as Record<string, unknown>,
            agentKeys.privateKeyPem,
          );
          ws.send(JSON.stringify(hello));
        };
        ws.onmessage = (event) => {
          void (async () => {
            const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (payload.type === "agent.ready") {
              clearTimeout(timeout);
              resolve();
              return;
            }
            if (payload.type === "policy.update") {
              const update = payload as unknown as PolicyUpdateEnvelope;
              expect(
                verifyEnvelope(update as unknown as Record<string, unknown>, controlPlanePublicKey),
              ).toBe(true);
              policy = update.policy;
              executor.updatePolicy(policy);
              return;
            }
            if (payload.type === "action.request") {
              const action = payload as unknown as ActionRequestEnvelope;
              expect(
                verifyEnvelope(action as unknown as Record<string, unknown>, controlPlanePublicKey),
              ).toBe(true);
              ws.send(JSON.stringify(await executor.execute(action)));
            }
          })().catch(reject);
        };
        ws.onerror = (error) => reject(new Error(String(error)));
      });

      const statusResult = await jsonFetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_system_status", arguments: { agent_id_or_alias: "local-test" } },
        }),
        expectedStatus: 200,
      });
      expect(statusResult.result).toBeDefined();

      const deniedShell = await jsonFetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "run_shell",
            arguments: {
              agent_id_or_alias: "local-test",
              command: "node -e \"process.stdout.write('denied')\"",
            },
          },
        }),
        expectedStatus: 403,
      });
      expect(JSON.stringify(deniedShell)).toContain("CAPABILITY_DENIED");

      await jsonFetch(`${baseUrl}/api/agents/${agentId}/policy`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ policy: { profile: "full-admin" } }),
        expectedStatus: 200,
      });

      let allowedShell: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          allowedShell = await jsonFetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: {
                name: "run_shell",
                arguments: {
                  agent_id_or_alias: "local-test",
                  command: "node -e \"process.stdout.write('allowed')\"",
                  timeout_seconds: 10,
                },
              },
            }),
            expectedStatus: 200,
          });
          break;
        } catch (error) {
          if (attempt === 19) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(JSON.stringify(allowedShell)).toContain("allowed");

      await jsonFetch(`${baseUrl}/api/agents/${agentId}/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        expectedStatus: 200,
      });
      const revokedResult = await jsonFetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "get_system_status", arguments: { agent_id_or_alias: "local-test" } },
        }),
        expectedStatus: 410,
      });
      expect(JSON.stringify(revokedResult)).toContain("AGENT_REVOKED");

      const audit = await jsonFetch(`${baseUrl}/api/audit`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        expectedStatus: 200,
      });
      expect(JSON.stringify(audit)).toContain("enrollment_token_created");
      expect(JSON.stringify(audit)).toContain("agent_connected");
      expect(JSON.stringify(audit)).toContain("action_requested");
      expect(JSON.stringify(audit)).toContain("action_allowed");
      expect(JSON.stringify(audit)).toContain("action_denied");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      controlPlane.close();
    }
  }, 30_000);

  test("closes invalid websocket messages and rejects malformed agent public keys", async () => {
    const { baseUrl, controlPlane, server } = await startHarness();
    try {
      const accessToken = await issueTestAccessToken(
        baseUrl,
        "agents:read agents:admin status:read",
      );
      await new Promise<void>((resolve, reject) => {
        const WebSocket = wsCtor();
        const ws = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/api/agents/connect`);
        const timeout = setTimeout(() => {
          reject(new Error("invalid websocket message was not rejected"));
        }, 5000);
        let sawError = false;
        ws.onopen = () => {
          ws.send(JSON.stringify([]));
        };
        ws.onmessage = (event) => {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (payload.type === "error") {
            sawError = true;
          }
        };
        ws.onclose = () => {
          clearTimeout(timeout);
          expect(sawError).toBe(true);
          resolve();
        };
        ws.onerror = (error) => {
          clearTimeout(timeout);
          reject(new Error(String(error)));
        };
      });

      const enrollment = await jsonFetch(`${baseUrl}/api/agents/enrollment-tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ alias: "invalid-key-test", requested_profile: "read-only" }),
        expectedStatus: 201,
      });
      await jsonFetch(`${baseUrl}/api/agents/enroll`, {
        method: "POST",
        body: JSON.stringify({
          token: String(enrollment.enrollment_token),
          public_key: "not-a-public-key",
          host: defaultHostMetadata(),
        }),
        expectedStatus: 400,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      controlPlane.close();
    }
  }, 30_000);

  test("keeps a reconnect online and rejects duplicate hello messages on one connection", async () => {
    const { baseUrl, controlPlane, server } = await startHarness();
    try {
      const accessToken = await issueTestAccessToken(
        baseUrl,
        "agents:read agents:admin status:read",
      );
      const enrollment = await jsonFetch(`${baseUrl}/api/agents/enrollment-tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ alias: "reconnect-test", requested_profile: "read-only" }),
        expectedStatus: 201,
      });
      const agentKeys = generateEd25519PemKeyPair();
      const enrollResponse = await jsonFetch(`${baseUrl}/api/agents/enroll`, {
        method: "POST",
        body: JSON.stringify({
          token: String(enrollment.enrollment_token),
          public_key: agentKeys.publicKeyPem,
          host: defaultHostMetadata(),
        }),
        expectedStatus: 200,
      });
      const agentId = String(enrollResponse.agent_id);
      const policy = enrollResponse.policy as AgentPolicy;
      const websocketUrl = String(enrollResponse.websocket_url);
      const first = await connectAgent(websocketUrl, agentId, agentKeys.privateKeyPem, policy);
      const second = await connectAgent(websocketUrl, agentId, agentKeys.privateKeyPem, policy);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const current = await jsonFetch(`${baseUrl}/api/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        expectedStatus: 200,
      });
      expect((current.agent as Record<string, unknown>).status).toBe("online");

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("duplicate hello was not rejected")),
          5000,
        );
        second.onmessage = (event) => {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (payload.type === "error") {
            clearTimeout(timeout);
            expect(payload.code).toBe("ACTION_REPLAY_DETECTED");
            resolve();
          }
        };
        second.onerror = (error) => {
          clearTimeout(timeout);
          reject(new Error(String(error)));
        };
        second.send(
          JSON.stringify(signedHello(agentId, agentKeys.privateKeyPem, policy, randomToken(16))),
        );
      });

      first.close();
      second.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      controlPlane.close();
    }
  }, 30_000);
});
