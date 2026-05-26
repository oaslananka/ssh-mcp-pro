import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, vi, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import {
  generateEd25519PemKeyPair,
  issueAccessToken,
  loadJwtKeyPair,
  nowIso,
  randomToken,
  sha256Base64Url,
  signEnvelope,
} from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { capabilitiesFromScopes, parseScopes } from "../../src/remote/scopes.js";
import type {
  ActionRecord,
  ActionRequestEnvelope,
  ActionResultEnvelope,
  RemotePrincipal,
  RemoteAgentRecord,
  RemoteConfig,
  RemoteCapability,
} from "../../src/remote/types.js";
import {
  AGENT_ENROLL_COMMAND,
  AGENT_RUN_COMMAND,
  LEGACY_AGENT_COMMAND_PATTERN,
} from "./helpers.js";

function testConfig(baseDir: string): RemoteConfig {
  const publicBaseUrl = "http://127.0.0.1:3000";
  return {
    enabled: true,
    publicBaseUrl,
    mcpResourceUrl: `${publicBaseUrl}/mcp`,
    databaseUrl: `file:${path.join(baseDir, "remote.db")}`,
    githubCallbackUrl: `${publicBaseUrl}/oauth/callback/github`,
    allowAllUsers: true,
    allowedGitHubLogins: [],
    allowedGitHubIds: [],
    accessTokenTtlSeconds: 900,
    authCodeTtlSeconds: 300,
    enrollmentTokenTtlSeconds: 600,
    controlPlaneSigningKeyPath: path.join(baseDir, "control-plane.json"),
    jwtSigningKeyPath: path.join(baseDir, "jwt.json"),
    agentWsPath: "/api/agents/connect",
    maxActionTimeoutSeconds: 120,
    maxOutputBytes: 200_000,
    maxOAuthClients: 100,
  };
}

interface CapturedResponse {
  statusCode?: number;
  headers?: Record<string, string>;
  body: string;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}

function captureResponse(): CapturedResponse {
  return {
    body: "",
    writeHead(status: number, headers: Record<string, string> = {}) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function request(
  method: string,
  url: string,
  body = "",
  headers: Record<string, string> = {},
): IncomingMessage {
  const stream = Readable.from(body ? [body] : []);
  return Object.assign(stream, { method, url, headers }) as IncomingMessage;
}

function jsonRequest(method: string, url: string, body: Record<string, unknown>): IncomingMessage {
  return request(method, url, JSON.stringify(body), { "content-type": "application/json" });
}

function responseBody(response: CapturedResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function principal(capabilities: RemoteCapability[]): RemotePrincipal {
  return {
    tokenId: "tok_test",
    userId: "github:1",
    githubId: "1",
    githubLogin: "tester",
    capabilities,
    scopes: [],
  };
}

function agentRecord(options: {
  id: string;
  alias: string;
  publicKey?: string | undefined;
  status?: RemoteAgentRecord["status"] | undefined;
}): RemoteAgentRecord {
  const policy = createAgentPolicy("read-only");
  const now = nowIso();
  return {
    id: options.id,
    userId: "github:1",
    alias: options.alias,
    status: options.status ?? "offline",
    publicKey: options.publicKey,
    profile: policy.profile,
    policy,
    policyVersion: policy.version,
    createdAt: now,
    updatedAt: now,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("remote control plane remote-agent contracts", () => {
  test("serves OAuth metadata, dynamic client registration, authorization, token, and JWKS flows", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const savedTestId = process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
    const savedTestLogin = process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
    process.env.SSHAUTOMATOR_TEST_GITHUB_ID = "1";
    process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN = "tester";
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const metadata = captureResponse();
      expect(
        await controlPlane.handleHttp(
          request("GET", "/.well-known/oauth-authorization-server"),
          metadata as ServerResponse,
          "/.well-known/oauth-authorization-server",
        ),
      ).toBe(true);
      expect(responseBody(metadata)).toEqual(
        expect.objectContaining({
          issuer: "http://127.0.0.1:3000",
          token_endpoint: "http://127.0.0.1:3000/oauth/token",
        }),
      );

      const protectedResource = captureResponse();
      await controlPlane.handleHttp(
        request("GET", "/.well-known/oauth-protected-resource"),
        protectedResource as ServerResponse,
        "/.well-known/oauth-protected-resource",
      );
      expect(responseBody(protectedResource)).toEqual(
        expect.objectContaining({
          resource: "http://127.0.0.1:3000/mcp",
          bearer_methods_supported: ["header"],
        }),
      );

      const register = captureResponse();
      await controlPlane.handleHttp(
        jsonRequest("POST", "/oauth/register", {
          client_name: "Unit Client",
          redirect_uris: ["http://localhost/callback"],
        }),
        register as ServerResponse,
        "/oauth/register",
      );
      const registered = responseBody(register);
      const clientId = String(registered.client_id);
      expect(register.statusCode).toBe(201);
      expect(registered).toEqual(
        expect.objectContaining({
          client_name: "Unit Client",
          redirect_uris: ["http://localhost/callback"],
          token_endpoint_auth_method: "none",
        }),
      );

      const verifier = "v".repeat(64);
      const authorizeUrl = new URL("http://127.0.0.1:3000/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("redirect_uri", "http://localhost/callback");
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("code_challenge", sha256Base64Url(verifier));
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("resource", "http://127.0.0.1:3000/mcp");
      authorizeUrl.searchParams.set("scope", "hosts:read agents:read");
      authorizeUrl.searchParams.set("state", "round-trip-state");
      const authorize = captureResponse();
      await controlPlane.handleHttp(
        request("GET", `${authorizeUrl.pathname}${authorizeUrl.search}`),
        authorize as ServerResponse,
        "/oauth/authorize",
      );
      expect(authorize.statusCode).toBe(302);
      const redirectLocation = new URL(String(authorize.headers?.Location));
      const code = redirectLocation.searchParams.get("code") ?? "";
      expect(code).not.toBe("");
      expect(redirectLocation.searchParams.get("state")).toBe("round-trip-state");

      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: "http://localhost/callback",
        code_verifier: verifier,
      });
      const token = captureResponse();
      await controlPlane.handleHttp(
        request("POST", "/oauth/token", tokenBody.toString(), {
          "content-type": "application/x-www-form-urlencoded",
        }),
        token as ServerResponse,
        "/oauth/token",
      );
      expect(token.statusCode).toBe(200);
      expect(responseBody(token)).toEqual(
        expect.objectContaining({
          token_type: "Bearer",
          expires_in: 900,
          scope: "hosts:read agents:read",
          access_token: expect.any(String),
        }),
      );

      const jwks = captureResponse();
      await controlPlane.handleHttp(
        request("GET", "/oauth/jwks.json"),
        jwks as ServerResponse,
        "/oauth/jwks.json",
      );
      expect(jwks.statusCode).toBe(200);
      expect(responseBody(jwks)).toEqual({ keys: [expect.objectContaining({ kty: "OKP" })] });
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
      if (savedTestId === undefined) {
        delete process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
      } else {
        process.env.SSHAUTOMATOR_TEST_GITHUB_ID = savedTestId;
      }
      if (savedTestLogin === undefined) {
        delete process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
      } else {
        process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN = savedTestLogin;
      }
    }
  });

  test("rejects invalid OAuth requests and exchanges GitHub callbacks", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const originalFetch = globalThis.fetch;
    const config = {
      ...testConfig(dir),
      githubClientId: "github-client",
      githubClientSecret: "github-secret",
    };
    const controlPlane = new RemoteControlPlane(config);
    await controlPlane.initialize();
    try {
      const harness = controlPlane as unknown as {
        store: RemoteControlPlane["store"];
        authorizeTransactions: Map<
          string,
          {
            clientId: string;
            redirectUri: string;
            codeChallenge: string;
            resource: string;
            scope: string;
            state: string;
            expiresAt: number;
          }
        >;
        validateAuthorizeParams(
          clientId: string,
          redirectUri: string,
          responseType: string,
          codeChallenge: string,
          codeChallengeMethod: string,
          resource: string,
          scope: string,
        ): void;
      };
      harness.store.insertClient({
        id: "row_oauth",
        clientId: "cli_oauth",
        clientName: "OAuth Client",
        redirectUris: ["http://localhost/callback"],
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: nowIso(),
      });

      expect(() =>
        harness.validateAuthorizeParams(
          "missing",
          "http://localhost/callback",
          "code",
          "challenge",
          "S256",
          config.mcpResourceUrl,
          "hosts:read",
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_CLIENT" }));
      expect(() =>
        harness.validateAuthorizeParams(
          "cli_oauth",
          "https://evil.example/callback",
          "code",
          "challenge",
          "S256",
          config.mcpResourceUrl,
          "hosts:read",
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_REDIRECT_URI" }));
      expect(() =>
        harness.validateAuthorizeParams(
          "cli_oauth",
          "http://localhost/callback",
          "token",
          "challenge",
          "S256",
          config.mcpResourceUrl,
          "hosts:read",
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_CLIENT" }));
      expect(() =>
        harness.validateAuthorizeParams(
          "cli_oauth",
          "http://localhost/callback",
          "code",
          "",
          "plain",
          config.mcpResourceUrl,
          "hosts:read",
        ),
      ).toThrow(expect.objectContaining({ code: "PKCE_VALIDATION_FAILED" }));
      expect(() =>
        harness.validateAuthorizeParams(
          "cli_oauth",
          "http://localhost/callback",
          "code",
          "challenge",
          "S256",
          "https://other.example/mcp",
          "hosts:read",
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_TOKEN" }));
      expect(() =>
        harness.validateAuthorizeParams(
          "cli_oauth",
          "http://localhost/callback",
          "code",
          "challenge",
          "S256",
          config.mcpResourceUrl,
          "unknown:scope",
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_SCOPE" }));

      const invalidRegister = captureResponse();
      await expect(
        controlPlane.handleHttp(
          jsonRequest("POST", "/oauth/register", { redirect_uris: ["http://evil.example/cb"] }),
          invalidRegister as ServerResponse,
          "/oauth/register",
        ),
      ).rejects.toMatchObject({ code: "INVALID_REDIRECT_URI" });

      const limited = new RemoteControlPlane({
        ...config,
        databaseUrl: ":memory:",
        maxOAuthClients: 0,
      });
      await limited.initialize();
      try {
        await expect(
          limited.handleHttp(
            jsonRequest("POST", "/oauth/register", {
              redirect_uris: ["http://localhost/callback"],
            }),
            captureResponse() as ServerResponse,
            "/oauth/register",
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 429 });
      } finally {
        limited.close();
      }

      const verifier = "g".repeat(64);
      const authorizeUrl = new URL("http://127.0.0.1:3000/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", "cli_oauth");
      authorizeUrl.searchParams.set("redirect_uri", "http://localhost/callback");
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("code_challenge", sha256Base64Url(verifier));
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("state", "state-to-github");
      const githubRedirect = captureResponse();
      await controlPlane.handleHttp(
        request("GET", `${authorizeUrl.pathname}${authorizeUrl.search}`),
        githubRedirect as ServerResponse,
        "/oauth/authorize",
      );
      expect(githubRedirect.statusCode).toBe(302);
      expect(String(githubRedirect.headers?.Location)).toContain(
        "https://github.com/login/oauth/authorize",
      );

      await expect(
        controlPlane.handleHttp(
          request("GET", "/oauth/callback/github?code=missing&state=missing"),
          captureResponse() as ServerResponse,
          "/oauth/callback/github",
        ),
      ).rejects.toMatchObject({ code: "INVALID_TOKEN" });

      harness.authorizeTransactions.set("tx-fail", {
        clientId: "cli_oauth",
        redirectUri: "http://localhost/callback",
        codeChallenge: sha256Base64Url(verifier),
        resource: config.mcpResourceUrl,
        scope: "hosts:read",
        state: "app-state",
        expiresAt: Date.now() + 30_000,
      });
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: "bad_verification_code" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      await expect(
        controlPlane.handleHttp(
          request("GET", "/oauth/callback/github?code=bad&state=tx-fail"),
          captureResponse() as ServerResponse,
          "/oauth/callback/github",
        ),
      ).rejects.toMatchObject({ code: "INVALID_TOKEN", status: 502 });

      harness.authorizeTransactions.set("tx-ok", {
        clientId: "cli_oauth",
        redirectUri: "http://localhost/callback",
        codeChallenge: sha256Base64Url(verifier),
        resource: config.mcpResourceUrl,
        scope: "hosts:read",
        state: "app-state",
        expiresAt: Date.now() + 30_000,
      });
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "gho_unit_test" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 1, login: "tester" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ) as unknown as typeof fetch;
      const callback = captureResponse();
      await controlPlane.handleHttp(
        request("GET", "/oauth/callback/github?code=ok&state=tx-ok"),
        callback as ServerResponse,
        "/oauth/callback/github",
      );
      expect(callback.statusCode).toBe(302);
      expect(String(callback.headers?.Location)).toContain("state=app-state");
      expect(String(callback.headers?.Location)).toContain("code=");
    } finally {
      globalThis.fetch = originalFetch;
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("covers unauthenticated MCP and API routing error branches", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const harness = controlPlane as unknown as {
        handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void>;
        handleAgentMessage(connection: unknown, message: string): Promise<void>;
        handleAgentEnroll(req: IncomingMessage, res: ServerResponse): Promise<void>;
      };
      const ready = captureResponse();
      await controlPlane.handleHttp(request("GET", "/readyz"), ready as ServerResponse, "/readyz");
      expect(responseBody(ready)).toEqual(
        expect.objectContaining({ ok: true, control_plane: true, agents_online: 0 }),
      );
      expect(
        await controlPlane.handleHttp(
          request("GET", "/missing"),
          captureResponse() as ServerResponse,
          "/missing",
        ),
      ).toBe(false);
      expect(
        controlPlane.handleUpgrade(
          request("GET", "/wrong"),
          { destroy: vi.fn() } as never,
          Buffer.alloc(0),
          "/wrong",
        ),
      ).toBe(false);

      const options = captureResponse();
      await harness.handleMcp(request("OPTIONS", "/mcp"), options as ServerResponse);
      expect(options.statusCode).toBe(204);

      const wrongMethod = captureResponse();
      await harness.handleMcp(request("GET", "/mcp"), wrongMethod as ServerResponse);
      expect(wrongMethod.statusCode).toBe(401);

      const badAuth = captureResponse();
      await harness.handleMcp(
        jsonRequest("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }),
        badAuth as ServerResponse,
      );
      expect(badAuth.statusCode).toBe(401);

      const connection = { sendJson: vi.fn(), close: vi.fn() };
      await harness.handleAgentMessage(connection, "null");
      await harness.handleAgentMessage(connection, JSON.stringify({ type: "unknown" }));
      expect(connection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INTERNAL_ERROR" }),
      );
      expect(connection.close).toHaveBeenCalledTimes(2);

      await expect(
        harness.handleAgentEnroll(
          jsonRequest("POST", "/api/agents/enroll", {}),
          captureResponse() as ServerResponse,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        harness.handleAgentEnroll(
          jsonRequest("POST", "/api/agents/enroll", {
            token: "token",
            public_key: "not-a-public-key",
            host: { hostname: "h", os: "Linux", arch: "x64", platform: "linux" },
          }),
          captureResponse() as ServerResponse,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serves authenticated MCP tool calls and API listing routes", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const config = testConfig(dir);
    const controlPlane = new RemoteControlPlane(config);
    await controlPlane.initialize();
    try {
      const harness = controlPlane as unknown as {
        handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void>;
        handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
        upsertGitHubUser(user: { id: string; login: string }): {
          id: string;
          githubId: string;
          githubLogin: string;
        };
      };
      harness.upsertGitHubUser({ id: "1", login: "tester" });
      const jwtKeyPair = await loadJwtKeyPair(config.jwtSigningKeyPath);
      const token = await issueAccessToken(
        config,
        jwtKeyPair,
        { id: "github:1", githubId: "1", githubLogin: "tester" },
        ["hosts:read", "agents:read", "status:read"],
      );
      const authHeaders = { authorization: `Bearer ${token.token}` };

      const initialize = captureResponse();
      await harness.handleMcp(
        jsonRequest("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" }),
        initialize as ServerResponse,
      );
      expect(initialize.statusCode).toBe(401);

      const authedInitialize = captureResponse();
      await harness.handleMcp(
        request("POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }), {
          ...authHeaders,
          "content-type": "application/json",
        }),
        authedInitialize as ServerResponse,
      );
      expect(responseBody(authedInitialize)).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({
            serverInfo: expect.objectContaining({ name: "sshautomator-remote-agent" }),
          }),
        }),
      );

      const toolsList = captureResponse();
      await harness.handleMcp(
        request("POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), {
          ...authHeaders,
          "content-type": "application/json",
        }),
        toolsList as ServerResponse,
      );
      expect(responseBody(toolsList)).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({
            tools: expect.arrayContaining([expect.objectContaining({ name: "list_hosts" })]),
          }),
        }),
      );

      const unknownTool = captureResponse();
      await harness.handleMcp(
        request(
          "POST",
          "/mcp",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "missing_tool", arguments: {} },
          }),
          { ...authHeaders, "content-type": "application/json" },
        ),
        unknownTool as ServerResponse,
      );
      expect(responseBody(unknownTool)).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({ message: "Unknown tool" }),
        }),
      );

      const malformedCall = captureResponse();
      await harness.handleMcp(
        request(
          "POST",
          "/mcp",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 33,
            method: "tools/call",
            params: "not-an-object",
          }),
          { ...authHeaders, "content-type": "application/json" },
        ),
        malformedCall as ServerResponse,
      );
      expect(responseBody(malformedCall)).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({ message: "Unknown tool" }),
        }),
      );

      const listHosts = captureResponse();
      await harness.handleMcp(
        request(
          "POST",
          "/mcp",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "list_hosts", arguments: {} },
          }),
          { ...authHeaders, "content-type": "application/json" },
        ),
        listHosts as ServerResponse,
      );
      expect(responseBody(listHosts)).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({
            structuredContent: { hosts: [] },
          }),
        }),
      );

      const missingMethod = captureResponse();
      await harness.handleMcp(
        request(
          "POST",
          "/mcp",
          JSON.stringify({ jsonrpc: "2.0", id: 5, method: "missing/method" }),
          { ...authHeaders, "content-type": "application/json" },
        ),
        missingMethod as ServerResponse,
      );
      expect(responseBody(missingMethod)).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({ message: "Method not found" }),
        }),
      );

      const agents = captureResponse();
      await harness.handleApi(
        request("GET", "/api/agents", "", authHeaders),
        agents as ServerResponse,
        "/api/agents",
      );
      expect(responseBody(agents)).toEqual({ agents: [] });

      const audit = captureResponse();
      await harness.handleApi(
        request("GET", "/api/audit?limit=1", "", authHeaders),
        audit as ServerResponse,
        "/api/audit",
      );
      expect(responseBody(audit)).toEqual({
        events: expect.arrayContaining([expect.objectContaining({ eventType: "user_login" })]),
      });

      const notFound = captureResponse();
      await harness.handleApi(
        request("GET", "/api/unknown", "", authHeaders),
        notFound as ServerResponse,
        "/api/unknown",
      );
      expect(notFound.statusCode).toBe(404);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("covers allowlist user matching and control-plane helper failures", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const config = {
      ...testConfig(dir),
      allowAllUsers: false,
      allowedGitHubIds: ["42"],
      allowedGitHubLogins: ["allowed-login"],
    };
    const controlPlane = new RemoteControlPlane(config);
    await controlPlane.initialize();
    try {
      const harness = controlPlane as unknown as {
        upsertGitHubUser(user: { id: string; login: string }): {
          id: string;
          githubId: string;
          githubLogin: string;
        };
        userFromId(userId: string): { id: string; githubId: string; githubLogin: string };
        requireJwtKeyPair(): unknown;
      };

      expect(harness.upsertGitHubUser({ id: "42", login: "by-id" })).toEqual(
        expect.objectContaining({ githubId: "42" }),
      );
      expect(harness.upsertGitHubUser({ id: "77", login: "allowed-login" })).toEqual(
        expect.objectContaining({ githubLogin: "allowed-login" }),
      );
      expect(() => harness.upsertGitHubUser({ id: "88", login: "blocked" })).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
      expect(() => harness.userFromId("local:1")).toThrow(
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );
      expect(() => harness.userFromId("github:missing")).toThrow(
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );

      const uninitialized = new RemoteControlPlane({ ...config, databaseUrl: ":memory:" });
      try {
        const uninitializedHarness = uninitialized as unknown as {
          requireJwtKeyPair(): unknown;
        };
        expect(() => uninitializedHarness.requireJwtKeyPair()).toThrow(
          "Remote control plane was not initialized",
        );
      } finally {
        uninitialized.close();
      }
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("handles agent hello lifecycle, remote tool management, and dispatched action results", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const agentKeys = generateEd25519PemKeyPair();
      const agent = agentRecord({
        id: "agt_lifecycle",
        alias: "lifecycle",
        publicKey: agentKeys.publicKeyPem,
      });
      const adminPrincipal = principal([
        "hosts.read",
        "agents.read",
        "agents.admin",
        "agent.admin",
        "audit.read",
        "system.read",
      ]);
      const closeHandlers: Array<() => void> = [];
      const connection = {
        sendJson: vi.fn(),
        close: vi.fn(),
        onClose: vi.fn((handler: () => void) => closeHandlers.push(handler)),
      };
      const harness = controlPlane as unknown as {
        store: RemoteControlPlane["store"];
        agentConnections: Map<
          string,
          { agent: RemoteAgentRecord; connection: unknown; seenNonces: Map<string, number> }
        >;
        handleAgentHello(connection: unknown, hello: unknown): Promise<void>;
        handleActionResult(connection: unknown, result: ActionResultEnvelope): Promise<void>;
        callRemoteTool(
          principal: RemotePrincipal,
          tool: string,
          args: Record<string, unknown>,
        ): Promise<Record<string, unknown>>;
      };
      harness.store.insertAgent(agent);

      const hello = {
        type: "agent.hello",
        agent_id: agent.id,
        timestamp: nowIso(),
        nonce: "nonce-agent-hello-live",
        capabilities: ["system.read"],
        agent_version: "1.0.0",
        host: { hostname: "prod", os: "Linux", arch: "x64", platform: "linux" },
        signature: "",
      };
      hello.signature = signEnvelope(hello, agentKeys.privateKeyPem);

      await harness.handleAgentHello(connection, hello);

      expect(harness.store.getAgent(agent.id)).toEqual(
        expect.objectContaining({
          status: "online",
          hostMetadata: expect.objectContaining({ hostname: "prod" }),
        }),
      );
      expect(connection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent.ready", agent_id: agent.id }),
      );

      expect(await harness.callRemoteTool(adminPrincipal, "list_hosts", {})).toEqual({
        hosts: [
          expect.objectContaining({
            id: agent.id,
            alias: agent.alias,
            status: "online",
          }),
        ],
      });
      expect(await harness.callRemoteTool(adminPrincipal, "list_agents", {})).toEqual({
        agents: [expect.objectContaining({ id: agent.id, alias: agent.alias })],
      });
      expect(
        await harness.callRemoteTool(adminPrincipal, "get_agent_install_command", {
          agent_id_or_alias: agent.alias,
        }),
      ).toEqual(
        expect.objectContaining({
          agent_id: agent.id,
          token_recoverable: false,
          commands: expect.objectContaining({ run: AGENT_RUN_COMMAND }),
        }),
      );

      const updated = await harness.callRemoteTool(adminPrincipal, "update_agent_policy", {
        agent_id_or_alias: agent.alias,
        policy: {
          profile: "operations",
          maxActionTimeoutSeconds: 999,
          maxOutputBytes: 999_999,
        },
      });
      expect(updated.agent).toEqual(
        expect.objectContaining({
          id: agent.id,
          profile: "operations",
          policy_version: 2,
        }),
      );
      expect(connection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ type: "policy.update", agent_id: agent.id, policy_version: 2 }),
      );

      const actionPromise = harness.callRemoteTool(adminPrincipal, "get_system_status", {
        agent_id_or_alias: agent.alias,
        timeout_seconds: 1,
      });
      await waitUntil(() =>
        connection.sendJson.mock.calls.some(
          ([message]) =>
            (message as { type?: string; action_id?: string }).type === "action.request",
        ),
      );
      const actionRequest = connection.sendJson.mock.calls
        .map(([message]) => message as ActionRequestEnvelope)
        .find((message) => message.type === "action.request");
      expect(actionRequest).toEqual(
        expect.objectContaining({
          agent_id: agent.id,
          tool: "get_system_status",
          capability: "system.read",
        }),
      );
      const result: ActionResultEnvelope = {
        type: "action.result",
        action_id: actionRequest?.action_id ?? "",
        agent_id: agent.id,
        nonce: "nonce-action-result-ok",
        status: "ok",
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        started_at: nowIso(),
        finished_at: nowIso(),
        truncated: false,
        signature: "",
      };
      result.signature = signEnvelope(
        result as unknown as Record<string, unknown>,
        agentKeys.privateKeyPem,
      );
      await harness.handleActionResult(connection, result);
      await expect(actionPromise).resolves.toEqual({
        action: expect.objectContaining({
          status: "ok",
          stdout: "ok",
        }),
      });

      expect(
        await harness.callRemoteTool(adminPrincipal, "get_audit_events", { limit: 5 }),
      ).toEqual({
        events: expect.arrayContaining([
          expect.objectContaining({ eventType: "action_completed" }),
        ]),
      });
      expect(
        await harness.callRemoteTool(adminPrincipal, "get_audit_events", {
          agent_id_or_alias: agent.alias,
          limit: 5,
        }),
      ).toEqual({
        events: expect.arrayContaining([
          expect.objectContaining({ agentId: agent.id, eventType: "action_completed" }),
        ]),
      });

      const nullPolicy = await harness.callRemoteTool(adminPrincipal, "update_agent_policy", {
        agent_id_or_alias: agent.alias,
        policy: null,
      });
      expect(nullPolicy.agent).toEqual(
        expect.objectContaining({
          id: agent.id,
          profile: "custom",
          policy_version: 3,
        }),
      );

      const revoked = await harness.callRemoteTool(adminPrincipal, "revoke_agent", {
        agent_id_or_alias: agent.alias,
      });
      expect(revoked.agent).toEqual(expect.objectContaining({ id: agent.id, status: "revoked" }));
      expect(connection.close).toHaveBeenCalled();

      const enrollment = await harness.callRemoteTool(adminPrincipal, "create_enrollment_token", {
        alias: "new-agent",
        requested_profile: "not-a-profile",
      });
      expect(enrollment).toEqual(
        expect.objectContaining({
          alias: "new-agent",
          enrollment_token: expect.any(String),
          commands: expect.objectContaining({ run: AGENT_RUN_COMMAND }),
        }),
      );

      closeHandlers.forEach((handler) => handler());
      expect(harness.store.getAgent(agent.id)).toEqual(
        expect.objectContaining({ status: "revoked" }),
      );
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects invalid agent hellos and invalid action result origins", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const keys = generateEd25519PemKeyPair();
      const agent = agentRecord({
        id: "agt_negative",
        alias: "negative",
        publicKey: keys.publicKeyPem,
      });
      const harness = controlPlane as unknown as {
        store: RemoteControlPlane["store"];
        agentConnections: Map<
          string,
          { agent: RemoteAgentRecord; connection: unknown; seenNonces: Map<string, number> }
        >;
        pendingActions: Map<
          string,
          {
            action: ActionRecord;
            resolve(value: ActionResultEnvelope): void;
            reject(error: Error): void;
            timeout: NodeJS.Timeout;
          }
        >;
        handleAgentHello(connection: unknown, hello: unknown): Promise<void>;
        handleActionResult(connection: unknown, result: ActionResultEnvelope): Promise<void>;
      };
      harness.store.insertAgent(agent);

      const unknownConnection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      await harness.handleAgentHello(unknownConnection, {
        type: "agent.hello",
        agent_id: "agt_missing",
        timestamp: nowIso(),
        nonce: "nonce-hello-missing",
        capabilities: ["system.read"],
        agent_version: "1.0.0",
        host: { hostname: "host", os: "Linux", arch: "x64", platform: "linux" },
        signature: "missing-agent-signature",
      });
      expect(unknownConnection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: "AGENT_NOT_FOUND" }),
      );
      expect(unknownConnection.close).toHaveBeenCalled();

      const invalidConnection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      await harness.handleAgentHello(invalidConnection, {
        type: "agent.hello",
        agent_id: agent.id,
        timestamp: nowIso(),
        nonce: "nonce-hello-invalid",
        capabilities: ["system.read"],
        agent_version: "1.0.0",
        host: { hostname: "host", os: "Linux", arch: "x64", platform: "linux" },
        signature: "invalid-signature",
      });
      expect(invalidConnection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SIGNATURE_INVALID" }),
      );

      const staleHello = {
        type: "agent.hello",
        agent_id: agent.id,
        timestamp: new Date(Date.now() - 600_000).toISOString(),
        nonce: "nonce-hello-stale",
        capabilities: ["system.read"],
        agent_version: "1.0.0",
        host: { hostname: "host", os: "Linux", arch: "x64", platform: "linux" },
        signature: "",
      };
      staleHello.signature = signEnvelope(staleHello, keys.privateKeyPem);
      const staleConnection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      await harness.handleAgentHello(staleConnection, staleHello);
      expect(staleConnection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACTION_EXPIRED" }),
      );

      const liveHello = {
        type: "agent.hello",
        agent_id: agent.id,
        timestamp: nowIso(),
        nonce: "nonce-hello-replay",
        capabilities: ["system.read"],
        agent_version: "1.0.0",
        host: { hostname: "host", os: "Linux", arch: "x64", platform: "linux" },
        signature: "",
      };
      liveHello.signature = signEnvelope(liveHello, keys.privateKeyPem);
      const liveConnection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      await harness.handleAgentHello(liveConnection, liveHello);
      const duplicateConnection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      const duplicateHello = {
        ...liveHello,
        nonce: "nonce-hello-duplicate",
        signature: "",
      };
      duplicateHello.signature = signEnvelope(duplicateHello, keys.privateKeyPem);
      await harness.handleAgentHello(liveConnection, duplicateHello);
      expect(liveConnection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACTION_REPLAY_DETECTED" }),
      );

      const replayHello = { ...liveHello, signature: "" };
      replayHello.signature = signEnvelope(replayHello, keys.privateKeyPem);
      await harness.handleAgentHello(duplicateConnection, replayHello);
      expect(duplicateConnection.sendJson).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACTION_REPLAY_DETECTED" }),
      );

      const now = nowIso();
      const action: ActionRecord = {
        id: "act_negative",
        userId: agent.userId,
        agentId: agent.id,
        tool: "get_system_status",
        capability: "system.read",
        args: {},
        status: "sent",
        issuedAt: now,
        deadline: new Date(Date.now() + 30_000).toISOString(),
      };
      const pendingReject = vi.fn();
      const timeout = setTimeout(() => undefined, 30_000);
      harness.pendingActions.set(action.id, {
        action,
        resolve: vi.fn(),
        reject: pendingReject,
        timeout,
      });
      await harness.handleActionResult(liveConnection, {
        type: "action.result",
        action_id: action.id,
        agent_id: agent.id,
        nonce: "nonce-result-invalid",
        status: "ok",
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        started_at: now,
        finished_at: nowIso(),
        truncated: false,
        signature: "invalid-result-signature",
      });
      expect(pendingReject).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Agent result signature is invalid" }),
      );

      const wrongConnectionReject = vi.fn();
      const wrongConnectionAction = { ...action, id: "act_wrong_connection" };
      const wrongConnectionTimeout = setTimeout(() => undefined, 30_000);
      harness.pendingActions.set(wrongConnectionAction.id, {
        action: wrongConnectionAction,
        resolve: vi.fn(),
        reject: wrongConnectionReject,
        timeout: wrongConnectionTimeout,
      });
      const wrongConnectionResult: ActionResultEnvelope = {
        type: "action.result",
        action_id: wrongConnectionAction.id,
        agent_id: agent.id,
        nonce: "nonce-result-wrong-conn",
        status: "ok",
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        started_at: now,
        finished_at: nowIso(),
        truncated: false,
        signature: "",
      };
      wrongConnectionResult.signature = signEnvelope(
        wrongConnectionResult as unknown as Record<string, unknown>,
        keys.privateKeyPem,
      );
      await harness.handleActionResult({ sendJson: vi.fn() }, wrongConnectionResult);
      expect(wrongConnectionReject).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SIGNATURE_INVALID" }),
      );

      await harness.handleActionResult(liveConnection, {
        ...wrongConnectionResult,
        action_id: "act_missing_pending",
        nonce: "nonce-result-missing",
      });
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects unauthorized remote tools and offline dispatches with safe errors", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const agent = agentRecord({ id: "agt_offline", alias: "offline" });
      const harness = controlPlane as unknown as {
        store: RemoteControlPlane["store"];
        callRemoteTool(
          principal: RemotePrincipal,
          tool: string,
          args: Record<string, unknown>,
        ): Promise<Record<string, unknown>>;
      };
      harness.store.insertAgent(agent);

      await expect(
        harness.callRemoteTool(principal(["agents.admin"]), "create_enrollment_token", {}),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        harness.callRemoteTool(principal(["agents.admin"]), "create_enrollment_token", {
          alias: agent.alias,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        harness.callRemoteTool(principal(["agents.admin"]), "get_agent_install_command", {}),
      ).rejects.toMatchObject({
        code: "AGENT_NOT_FOUND",
      });
      await expect(
        harness.callRemoteTool(principal(["hosts.read"]), "update_agent_policy", {
          agent_id_or_alias: agent.alias,
          policy: { profile: "operations" },
        }),
      ).rejects.toMatchObject({
        code: "INVALID_SCOPE",
        status: 403,
      });
      await expect(
        harness.callRemoteTool(principal(["hosts.read"]), "revoke_agent", {
          agent_id_or_alias: agent.alias,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_SCOPE",
        status: 403,
      });

      await expect(
        harness.callRemoteTool(principal(["system.read"]), "get_system_status", {
          agent_id_or_alias: agent.alias,
        }),
      ).rejects.toMatchObject({
        code: "AGENT_OFFLINE",
        status: 503,
      });
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("generates deterministic agent CLI commands for enrollment", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const principal: RemotePrincipal = {
        tokenId: "tok_test",
        userId: "github:1",
        githubId: "1",
        githubLogin: "tester",
        capabilities: capabilitiesFromScopes(parseScopes("agents:admin")),
        scopes: ["agents:admin"],
      };
      const harness = controlPlane as unknown as {
        createEnrollmentToken(
          principal: RemotePrincipal,
          args: Record<string, unknown>,
        ): Record<string, unknown>;
      };

      const result = harness.createEnrollmentToken(principal, {
        alias: "prod one",
        requested_profile: "operations",
      });

      expect(result.commands).toEqual(
        expect.objectContaining({
          npm: expect.stringContaining(AGENT_ENROLL_COMMAND),
          run: AGENT_RUN_COMMAND,
          windows: expect.stringContaining(AGENT_ENROLL_COMMAND),
        }),
      );
      expect(JSON.stringify(result.commands)).toContain("--alias 'prod one'");
      expect(JSON.stringify(result.commands)).not.toMatch(LEGACY_AGENT_COMMAND_PATTERN);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("generates canonical install commands for existing agents without exposing a stale token", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const policy = createAgentPolicy("operations");
      const now = nowIso();
      const agent: RemoteAgentRecord = {
        id: "agt_install_contract",
        userId: "github:1",
        alias: "prod 'core'",
        status: "online",
        publicKey: generateEd25519PemKeyPair().publicKeyPem,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      const harness = controlPlane as unknown as {
        installCommand(
          agent: RemoteAgentRecord,
          token: string | undefined,
        ): Record<string, unknown>;
      };

      const result = harness.installCommand(agent, undefined);
      const commands = result.commands as Record<string, string>;
      const serialized = JSON.stringify(result);

      expect(result).toEqual(
        expect.objectContaining({
          agent_id: agent.id,
          alias: agent.alias,
          token_recoverable: false,
          commands: expect.objectContaining({
            npm: expect.stringContaining(AGENT_ENROLL_COMMAND),
            run: AGENT_RUN_COMMAND,
            windows: expect.stringContaining(AGENT_ENROLL_COMMAND),
          }),
        }),
      );
      expect(serialized).toContain("<create-a-new-enrollment-token>");
      expect(commands.npm).toContain(`--alias 'prod '"'"'core'"'"''`);
      expect(commands.windows).toContain("--alias 'prod ''core'''");
      expect(serialized).not.toMatch(LEGACY_AGENT_COMMAND_PATTERN);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects an action result nonce that was already seen on the connection", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const keys = generateEd25519PemKeyPair();
      const policy = createAgentPolicy("read-only");
      const now = nowIso();
      const agent: RemoteAgentRecord = {
        id: "agt_replay",
        userId: "github:1",
        alias: "replay",
        status: "online",
        publicKey: keys.publicKeyPem,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      const action: ActionRecord = {
        id: "act_replay",
        userId: agent.userId,
        agentId: agent.id,
        tool: "get_system_status",
        capability: "system.read",
        args: {},
        status: "sent",
        issuedAt: now,
        deadline: new Date(Date.now() + 30_000).toISOString(),
      };
      const replayNonce = randomToken(16);
      const connection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      const resolve = vi.fn();
      const reject = vi.fn();
      const timeout = setTimeout(() => undefined, 30_000);
      const harness = controlPlane as unknown as {
        store: {
          insertAgent(agent: RemoteAgentRecord): void;
          listAudit(userId: string, agentId: string | undefined, limit: number): unknown[];
        };
        agentConnections: Map<
          string,
          { agent: RemoteAgentRecord; connection: unknown; seenNonces: Map<string, number> }
        >;
        pendingActions: Map<
          string,
          {
            action: ActionRecord;
            resolve(value: ActionResultEnvelope): void;
            reject(error: Error): void;
            timeout: NodeJS.Timeout;
          }
        >;
        handleActionResult(connection: unknown, result: ActionResultEnvelope): Promise<void>;
      };
      harness.store.insertAgent(agent);
      harness.agentConnections.set(agent.id, {
        agent,
        connection,
        seenNonces: new Map([[replayNonce, Date.now() + 30_000]]),
      });
      harness.pendingActions.set(action.id, { action, resolve, reject, timeout });
      const result: ActionResultEnvelope = {
        type: "action.result",
        action_id: action.id,
        agent_id: agent.id,
        nonce: replayNonce,
        status: "ok",
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        started_at: now,
        finished_at: nowIso(),
        truncated: false,
        signature: "",
      };
      result.signature = signEnvelope(
        result as unknown as Record<string, unknown>,
        keys.privateKeyPem,
      );

      await harness.handleActionResult(connection, result);

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACTION_REPLAY_DETECTED" }),
      );
      expect(JSON.stringify(harness.store.listAudit(agent.userId, undefined, 20))).toContain(
        "agent_result_replay_detected",
      );
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prunes expired action result nonces from live connections", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const policy = createAgentPolicy("read-only");
      const now = nowIso();
      const agent: RemoteAgentRecord = {
        id: "agt_nonce_prune",
        userId: "github:1",
        alias: "nonce-prune",
        status: "online",
        publicKey: generateEd25519PemKeyPair().publicKeyPem,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      const seenNonces = new Map<string, number>([
        ["expired-nonce", Date.now() - 1],
        ["fresh-nonce", Date.now() + 30_000],
      ]);
      const harness = controlPlane as unknown as {
        agentConnections: Map<
          string,
          { agent: RemoteAgentRecord; connection: unknown; seenNonces: Map<string, number> }
        >;
        cleanupEphemeralState(now?: number): void;
      };

      harness.agentConnections.set(agent.id, {
        agent,
        connection: { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() },
        seenNonces,
      });

      harness.cleanupEphemeralState(Date.now());

      expect(seenNonces.has("expired-nonce")).toBe(false);
      expect(seenNonces.has("fresh-nonce")).toBe(true);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
