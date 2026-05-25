import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { randomToken } from "../../src/remote/crypto.js";
import type { RemoteConfig } from "../../src/remote/types.js";

interface Harness {
  baseUrl: string;
  controlPlane: RemoteControlPlane;
  dir: string;
  server: Server;
}

function config(baseUrl: string, dir: string, overrides: Partial<RemoteConfig> = {}): RemoteConfig {
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
    ...overrides,
  };
}

async function listenOnLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.listen(0, "127.0.0.1", onListening);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function attachControlPlane(
  server: Server,
  controlPlane: RemoteControlPlane,
  baseUrl: string,
): void {
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    void controlPlane
      .handleHttp(req, res, new URL(req.url ?? "/", baseUrl).pathname)
      .then((handled) => {
        if (!handled && !res.headersSent) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
      })
      .catch((error) => {
        if (res.headersSent) {
          return;
        }
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
}

async function startHarness(overrides: Partial<RemoteConfig> = {}): Promise<Harness> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-oauth-flow-"));
  const server = createServer();
  let controlPlane: RemoteControlPlane | undefined;

  try {
    await listenOnLoopback(server);
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Unable to resolve listening address");
    }

    const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    controlPlane = new RemoteControlPlane(config(baseUrl, dir, overrides));
    await controlPlane.initialize();
    attachControlPlane(server, controlPlane, baseUrl);
    return { baseUrl, controlPlane, dir, server };
  } catch (error) {
    await closeServer(server);
    controlPlane?.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function closeHarness(harness: Harness): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    harness.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  harness.controlPlane.close();
  rmSync(harness.dir, { recursive: true, force: true });
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Expected JSON object response");
  }
  return payload as Record<string, unknown>;
}

async function registerClient(baseUrl: string, redirectUri: string): Promise<string> {
  const response = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "PKCE Integration Test",
      redirect_uris: [redirectUri],
    }),
  });
  const body = await readJson(response);
  expect(response.status).toBe(201);
  expect(body.token_endpoint_auth_method).toBe("none");
  return String(body.client_id);
}

async function authorize(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  verifier: string,
  scope = "hosts:read agents:read status:read logs:read",
): Promise<string> {
  const state = `state-${randomToken(8)}`;
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("resource", `${baseUrl}/mcp`);
  authorizeUrl.searchParams.set("scope", scope);

  const response = await fetch(authorizeUrl, { redirect: "manual" });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const redirectLocation = new URL(location ?? "");
  expect(`${redirectLocation.origin}${redirectLocation.pathname}`).toBe(redirectUri);
  expect(redirectLocation.searchParams.get("state")).toBe(state);
  const code = redirectLocation.searchParams.get("code");
  expect(code).toBeTruthy();
  return code ?? "";
}

async function exchangeCode(
  baseUrl: string,
  clientId: string,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<Response> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  return fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function issueAccessToken(baseUrl: string): Promise<string> {
  const redirectUri = `${baseUrl}/callback-${randomToken(6)}`;
  const clientId = await registerClient(baseUrl, redirectUri);
  const verifier = `verifier-${randomToken(48)}`;
  const code = await authorize(baseUrl, clientId, redirectUri, verifier);
  const tokenResponse = await exchangeCode(baseUrl, clientId, code, redirectUri, verifier);
  const token = await readJson(tokenResponse);
  expect(tokenResponse.status).toBe(200);
  expect(token).toEqual(
    expect.objectContaining({
      access_token: expect.any(String),
      expires_in: expect.any(Number),
      scope: "hosts:read agents:read status:read logs:read",
      token_type: "Bearer",
    }),
  );
  return String(token.access_token);
}

async function callProtectedMcp(baseUrl: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

describe("OAuth PKCE HTTP flow", () => {
  let previousId: string | undefined;
  let previousLogin: string | undefined;

  beforeEach(() => {
    previousId = process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
    previousLogin = process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
    process.env.SSHAUTOMATOR_TEST_GITHUB_ID = "1";
    process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN = "tester";
  });

  afterEach(() => {
    vi.useRealTimers();
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

  test("exchanges an authorization code with S256 PKCE and calls a protected MCP endpoint", async () => {
    const harness = await startHarness();
    try {
      const accessToken = await issueAccessToken(harness.baseUrl);
      const mcpResponse = await callProtectedMcp(harness.baseUrl, accessToken);
      const mcpBody = await readJson(mcpResponse);
      expect(mcpResponse.status).toBe(200);
      expect(mcpBody).toEqual(
        expect.objectContaining({
          jsonrpc: "2.0",
          id: 1,
          result: expect.objectContaining({ tools: expect.any(Array) }),
        }),
      );
    } finally {
      await closeHarness(harness);
    }
  });

  test("rejects authorization code exchange with the wrong PKCE verifier", async () => {
    const harness = await startHarness();
    try {
      const redirectUri = `${harness.baseUrl}/callback-${randomToken(6)}`;
      const clientId = await registerClient(harness.baseUrl, redirectUri);
      const verifier = `verifier-${randomToken(48)}`;
      const code = await authorize(harness.baseUrl, clientId, redirectUri, verifier);
      const tokenResponse = await exchangeCode(
        harness.baseUrl,
        clientId,
        code,
        redirectUri,
        `wrong-${verifier}`,
      );
      const tokenBody = await readJson(tokenResponse);
      expect(tokenResponse.status).toBe(400);
      expect(tokenBody).toEqual(
        expect.objectContaining({
          code: "PKCE_VALIDATION_FAILED",
          error: "Invalid PKCE code_verifier",
        }),
      );
    } finally {
      await closeHarness(harness);
    }
  });

  test("rejects an expired access token at a protected MCP endpoint", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(issuedAt);

    const harness = await startHarness({ accessTokenTtlSeconds: 1 });
    try {
      const accessToken = await issueAccessToken(harness.baseUrl);
      const validResponse = await callProtectedMcp(harness.baseUrl, accessToken);
      expect(validResponse.status).toBe(200);

      vi.setSystemTime(new Date(issuedAt.getTime() + 2_000));
      const expiredResponse = await callProtectedMcp(harness.baseUrl, accessToken);
      const expiredBody = await readJson(expiredResponse);
      expect(expiredResponse.status).toBe(401);
      expect(expiredResponse.headers.get("www-authenticate")).toContain("Bearer");
      expect(expiredBody).toEqual({ error: "Missing or invalid bearer token" });
    } finally {
      await closeHarness(harness);
    }
  });
});
