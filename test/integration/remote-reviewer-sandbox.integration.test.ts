import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import {
  REMOTE_CAPABILITIES,
  REMOTE_SCOPES,
  REVIEWER_DEMO_USER_ID,
  type RemoteAgentRecord,
  type RemotePrincipal,
  type RemoteToolName,
} from "../../src/remote/types.js";
import {
  captureResponse,
  jsonRequest,
  request,
  testConfig,
} from "../helpers/web-dashboard-fixture.js";
import { writeTestHttpError } from "../helpers/http-error.js";

const REVIEWER_USERNAME = "openai-reviewer";
const REVIEWER_PASSWORD = "reviewer-password-for-integration-tests-only";
const PUBLIC_BASE_URL = "http://127.0.0.1:3000";

function reviewerPasswordHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function jsonBodyRequest(
  method: string,
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): IncomingMessage {
  const raw = JSON.stringify(body);
  return Object.assign(
    Readable.from([Buffer.from(raw)]),
    request(method, url, { "content-type": "application/json", ...headers }),
  ) as IncomingMessage;
}

function formRequest(
  method: string,
  url: string,
  values: Record<string, string>,
  headers: Record<string, string> = {},
): IncomingMessage {
  const body = new URLSearchParams(values).toString();
  return Object.assign(
    Readable.from([Buffer.from(body)]),
    request(method, url, {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(Buffer.byteLength(body)),
      ...headers,
    }),
  ) as IncomingMessage;
}

async function dispatch(
  controlPlane: RemoteControlPlane,
  incoming: IncomingMessage,
  pathname: string,
) {
  const response = captureResponse();
  let handled = false;
  try {
    handled = await controlPlane.handleHttp(
      incoming,
      response as unknown as ServerResponse,
      pathname,
    );
  } catch (error) {
    writeTestHttpError(response as unknown as ServerResponse, error);
    handled = true;
  }
  return { handled, response };
}

function setCookie(response: ReturnType<typeof captureResponse>, name: string): string | undefined {
  const header = response.getHeader("set-cookie");
  const lines = Array.isArray(header) ? header : header ? [header] : [];
  const prefix = `${name}=`;
  const line = lines.find((value) => value.startsWith(prefix));
  return line?.split(";")[0];
}

function csrfFromPage(html: string): string {
  const value = /name="csrf" value="([A-Za-z0-9_-]{43})"/u.exec(html)?.[1];
  if (!value) throw new Error("Reviewer page did not contain a CSRF token");
  return value;
}

function createControlPlane(dir: string, enabled = true): RemoteControlPlane {
  const base = testConfig(dir);
  return new RemoteControlPlane({
    ...base,
    githubClientId: undefined,
    githubClientSecret: undefined,
    googleClientId: undefined,
    googleClientSecret: undefined,
    reviewerUsername: enabled ? REVIEWER_USERNAME : undefined,
    reviewerPasswordHash: enabled ? reviewerPasswordHash(REVIEWER_PASSWORD) : undefined,
  });
}

async function reviewerLoginPage(controlPlane: RemoteControlPlane) {
  return dispatch(controlPlane, request("GET", "/oauth/reviewer/login"), "/oauth/reviewer/login");
}

async function login(
  controlPlane: RemoteControlPlane,
  username = REVIEWER_USERNAME,
  password = REVIEWER_PASSWORD,
) {
  const page = await reviewerLoginPage(controlPlane);
  const csrf = csrfFromPage(page.response.body);
  const csrfCookie = setCookie(page.response, "ssh_mcp_reviewer_csrf");
  if (!csrfCookie) throw new Error("Reviewer login did not set its CSRF cookie");
  return dispatch(
    controlPlane,
    formRequest(
      "POST",
      "/oauth/reviewer/login",
      { csrf, username, password },
      { origin: PUBLIC_BASE_URL, cookie: csrfCookie },
    ),
    "/oauth/reviewer/login",
  );
}

function authorizationUrl(clientId: string, redirectUri: string, scope: string): string {
  const url = new URL("/oauth/authorize", PUBLIC_BASE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update("reviewer-pkce-verifier").digest("base64url"),
  );
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", `${PUBLIC_BASE_URL}/mcp`);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", "reviewer-state");
  return `${url.pathname}${url.search}`;
}

describe("OpenAI reviewer sandbox browser authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps reviewer login unavailable unless both credentials are configured", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-disabled-"));
    const controlPlane = createControlPlane(dir, false);
    try {
      const result = await reviewerLoginPage(controlPlane);
      expect(result.handled).toBe(true);
      expect(result.response.statusCode).toBe(404);
      expect(result.response.body).not.toContain("openai-reviewer");
      expect(result.response.getHeader("cache-control")).toContain("no-store");
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("renders an accessible synthetic-only login and rejects invalid CSRF and origins", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-form-"));
    const controlPlane = createControlPlane(dir);
    try {
      const page = await reviewerLoginPage(controlPlane);
      expect(page.handled).toBe(true);
      expect(page.response.statusCode).toBe(200);
      expect(page.response.body).toContain('<html lang="en">');
      expect(page.response.body).toContain("Review sandbox — synthetic data only");
      expect(page.response.body).toContain('autocomplete="username"');
      expect(page.response.body).toContain('autocomplete="current-password"');
      expect(page.response.body).toContain('name="username"');
      expect(page.response.body).toContain('name="password"');
      expect(page.response.getHeader("cache-control")).toContain("no-store");
      expect(page.response.getHeader("referrer-policy")).toBe("no-referrer");
      expect(page.response.getHeader("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(setCookie(page.response, "ssh_mcp_reviewer_csrf")).toBeTruthy();

      const missingCsrf = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          { username: REVIEWER_USERNAME, password: REVIEWER_PASSWORD },
          { origin: PUBLIC_BASE_URL },
        ),
        "/oauth/reviewer/login",
      );
      expect(missingCsrf.response.statusCode).toBe(403);

      const csrf = csrfFromPage(page.response.body);
      const csrfCookie = setCookie(page.response, "ssh_mcp_reviewer_csrf")!;
      const crossOrigin = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          { csrf, username: REVIEWER_USERNAME, password: REVIEWER_PASSWORD },
          { origin: "https://attacker.example", cookie: csrfCookie },
        ),
        "/oauth/reviewer/login",
      );
      expect(crossOrigin.response.statusCode).toBe(403);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns to the original OAuth consent request after reviewer login without allowing open redirects", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-return-to-"));
    const controlPlane = createControlPlane(dir);
    try {
      const registered = await dispatch(
        controlPlane,
        jsonRequest("POST", "/oauth/register", {
          client_name: "Reviewer Return-To Test",
          redirect_uris: ["http://localhost/reviewer-return-callback"],
        }),
        "/oauth/register",
      );
      const clientId = String(JSON.parse(registered.response.body).client_id);
      const authorizeUrl = authorizationUrl(
        clientId,
        "http://localhost/reviewer-return-callback",
        "hosts:read agents:read status:read shell:exec",
      );
      const authorize = await dispatch(
        controlPlane,
        request("GET", authorizeUrl),
        "/oauth/authorize",
      );
      const loginHref = /href="([^"]*oauth\/reviewer\/login[^"]*)"/u.exec(
        authorize.response.body,
      )?.[1];
      if (!loginHref) throw new Error("OAuth consent page did not link to reviewer login");
      const loginUrl = new URL(loginHref.replaceAll("&amp;", "&"), PUBLIC_BASE_URL);
      const returnTo = loginUrl.searchParams.get("return_to");
      expect(returnTo).toBe(authorizeUrl);

      const loginPage = await dispatch(
        controlPlane,
        request("GET", `${loginUrl.pathname}${loginUrl.search}`),
        "/oauth/reviewer/login",
      );
      expect(loginPage.response.body).toContain('name="return_to"');
      const csrf = csrfFromPage(loginPage.response.body);
      const csrfCookie = setCookie(loginPage.response, "ssh_mcp_reviewer_csrf")!;
      const invalidReturnTo = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          {
            csrf,
            username: REVIEWER_USERNAME,
            password: REVIEWER_PASSWORD,
            return_to: "https://attacker.example/oauth/authorize?client_id=evil",
          },
          { origin: PUBLIC_BASE_URL, cookie: csrfCookie },
        ),
        "/oauth/reviewer/login",
      );
      expect(invalidReturnTo.response.statusCode).toBe(400);

      const retryPage = await dispatch(
        controlPlane,
        request("GET", `${loginUrl.pathname}${loginUrl.search}`),
        "/oauth/reviewer/login",
      );
      const retryCsrf = csrfFromPage(retryPage.response.body);
      const retryCsrfCookie = setCookie(retryPage.response, "ssh_mcp_reviewer_csrf")!;
      const signedIn = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          {
            csrf: retryCsrf,
            username: REVIEWER_USERNAME,
            password: REVIEWER_PASSWORD,
            return_to: returnTo!,
          },
          { origin: PUBLIC_BASE_URL, cookie: retryCsrfCookie },
        ),
        "/oauth/reviewer/login",
      );
      expect(signedIn.response.statusCode).toBe(303);
      expect(signedIn.response.getHeader("location")).toBe(returnTo);
      const sessionCookie = setCookie(signedIn.response, "ssh_mcp_reviewer_session")!;
      const resumedAuthorize = await dispatch(
        controlPlane,
        request("GET", returnTo!, { cookie: sessionCookie }),
        "/oauth/authorize",
      );
      expect(resumedAuthorize.response.statusCode).toBe(200);
      expect(resumedAuthorize.response.body).toContain("Review sandbox — synthetic data only");
      expect(resumedAuthorize.response.body).toContain("Continue with reviewer sandbox");
      expect(resumedAuthorize.response.body).not.toContain("shell:exec");
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses generic credential errors, bounds failed attempts, and stores only a hashed session", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-session-"));
    const controlPlane = createControlPlane(dir);
    try {
      const invalid = await login(controlPlane, "wrong-user", "wrong-password");
      expect(invalid.response.statusCode).toBe(401);
      expect(invalid.response.body).toContain("Invalid username or password");
      expect(invalid.response.body).not.toContain("wrong-user");
      expect(controlPlane.store.getUserById(REVIEWER_DEMO_USER_ID)).toBeUndefined();

      const valid = await login(controlPlane);
      expect(valid.response.statusCode).toBe(200);
      expect(valid.response.body).toContain("Reviewer session ready");
      expect(valid.response.body).toContain("synthetic sample data");
      const sessionCookie = setCookie(valid.response, "ssh_mcp_reviewer_session");
      expect(sessionCookie).toBeTruthy();
      const rawToken = sessionCookie!.slice("ssh_mcp_reviewer_session=".length);
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(
        controlPlane.store.getDashboardSession(hashSecret(rawToken), new Date().toISOString()),
      ).toEqual({ userId: REVIEWER_DEMO_USER_ID });
      expect(
        controlPlane.store.getDashboardSession(rawToken, new Date().toISOString()),
      ).toBeUndefined();
      expect(controlPlane.store.getUserById(REVIEWER_DEMO_USER_ID)).toMatchObject({
        provider: "demo",
        githubId: undefined,
        googleId: undefined,
        email: undefined,
      });

      const csrf = csrfFromPage(valid.response.body);
      const csrfCookie = setCookie(valid.response, "ssh_mcp_reviewer_csrf")!;
      const rejectedLogout = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/logout",
          { csrf: "invalid-csrf-token" },
          { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${csrfCookie}` },
        ),
        "/oauth/reviewer/logout",
      );
      expect(rejectedLogout.response.statusCode).toBe(403);
      expect(
        controlPlane.store.getDashboardSession(hashSecret(rawToken), new Date().toISOString()),
      ).toEqual({ userId: REVIEWER_DEMO_USER_ID });

      const ownerNow = new Date().toISOString();
      const ownerToken = randomToken(32);
      controlPlane.store.upsertUser({
        internalId: "github:reviewer-boundary-owner",
        id: "reviewer-boundary-owner",
        login: "reviewer-boundary-owner",
        now: ownerNow,
      });
      controlPlane.store.createDashboardSession(
        hashSecret(ownerToken),
        "github:reviewer-boundary-owner",
        new Date(Date.now() + 60_000).toISOString(),
        ownerNow,
      );
      const ownerLogout = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/logout",
          { csrf },
          {
            origin: PUBLIC_BASE_URL,
            cookie: `ssh_mcp_reviewer_session=${ownerToken}; ${csrfCookie}`,
          },
        ),
        "/oauth/reviewer/logout",
      );
      expect(ownerLogout.response.statusCode).toBe(303);
      expect(
        controlPlane.store.getDashboardSession(hashSecret(ownerToken), new Date().toISOString()),
      ).toEqual({ userId: "github:reviewer-boundary-owner" });

      const refreshedReadyPage = await dispatch(
        controlPlane,
        request("GET", "/oauth/reviewer/login", { cookie: sessionCookie }),
        "/oauth/reviewer/login",
      );
      const logoutCsrf = csrfFromPage(refreshedReadyPage.response.body);
      const logoutCsrfCookie = setCookie(refreshedReadyPage.response, "ssh_mcp_reviewer_csrf")!;
      const logout = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/logout",
          { csrf: logoutCsrf },
          { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${logoutCsrfCookie}` },
        ),
        "/oauth/reviewer/logout",
      );
      expect(logout.response.statusCode).toBe(303);
      const logoutCookies = logout.response.getHeader("set-cookie");
      const logoutCookieLines = Array.isArray(logoutCookies) ? logoutCookies : [logoutCookies];
      expect(logoutCookieLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "ssh_mcp_reviewer_session=; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=0",
          ),
        ]),
      );
      expect(
        controlPlane.store.getDashboardSession(hashSecret(rawToken), new Date().toISOString()),
      ).toBeUndefined();
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("limits a peer and username to five failed attempts in the rolling window", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-rate-limit-"));
    const controlPlane = createControlPlane(dir);
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await login(controlPlane, REVIEWER_USERNAME, "wrong-password");
        statuses.push(result.response.statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("treats expired reviewer sessions as signed out", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-session-expiry-"));
    const controlPlane = createControlPlane(dir);
    try {
      const now = new Date().toISOString();
      const expiredToken = randomToken(32);
      controlPlane.store.upsertReviewerUser(now);
      controlPlane.store.createDashboardSession(
        hashSecret(expiredToken),
        REVIEWER_DEMO_USER_ID,
        new Date(Date.now() - 1_000).toISOString(),
        now,
      );
      const result = await dispatch(
        controlPlane,
        request("GET", "/oauth/reviewer/login", {
          cookie: `ssh_mcp_reviewer_session=${expiredToken}`,
        }),
        "/oauth/reviewer/login",
      );
      expect(result.response.statusCode).toBe(200);
      expect(result.response.body).toContain('name="password"');
      expect(result.response.body).not.toContain("Reviewer session ready");
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serves only synthetic reviewer devices and status without touching production agents or dispatch", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-synthetic-mcp-"));
    const controlPlane = createControlPlane(dir);
    try {
      await controlPlane.initialize();
      const loginResult = await login(controlPlane);
      const sessionCookie = setCookie(loginResult.response, "ssh_mcp_reviewer_session")!;
      const registered = await dispatch(
        controlPlane,
        jsonRequest("POST", "/oauth/register", {
          client_name: "Reviewer Synthetic MCP",
          redirect_uris: ["http://localhost/reviewer-synthetic-callback"],
        }),
        "/oauth/register",
      );
      const clientId = String(JSON.parse(registered.response.body).client_id);
      const redirectUri = "http://localhost/reviewer-synthetic-callback";
      const authorize = await dispatch(
        controlPlane,
        request(
          "GET",
          authorizationUrl(clientId, redirectUri, "hosts:read agents:read status:read"),
          { cookie: sessionCookie },
        ),
        "/oauth/authorize",
      );
      const transactionCookie = setCookie(authorize.response, "ssh_mcp_oauth_tx")!;
      const transaction = transactionCookie.slice("ssh_mcp_oauth_tx=".length);
      const approved = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/approve",
          { transaction, provider: "reviewer_demo" },
          { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${transactionCookie}` },
        ),
        "/oauth/approve",
      );
      const callbackHref = /href="([^"]+)"/u.exec(approved.response.body)?.[1];
      if (!callbackHref) throw new Error("Reviewer approval did not return an authorization code");
      const code = new URL(callbackHref.replaceAll("&amp;", "&")).searchParams.get("code") ?? "";
      const tokenResult = await dispatch(
        controlPlane,
        formRequest("POST", "/oauth/token", {
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: "reviewer-pkce-verifier",
        }),
        "/oauth/token",
      );
      expect(tokenResult.response.statusCode).toBe(200);
      const accessToken = String(JSON.parse(tokenResult.response.body).access_token);
      const authorization = { authorization: `Bearer ${accessToken}` };

      const ownerId = "github:reviewer-synthetic-owner";
      const now = new Date().toISOString();
      controlPlane.store.upsertUser({
        internalId: ownerId,
        id: "reviewer-synthetic-owner",
        login: "reviewer-synthetic-owner",
        now,
      });
      const ownerAgent: RemoteAgentRecord = {
        id: "owner-production-agent",
        userId: ownerId,
        alias: "owner-production-device",
        status: "online",
        profile: "read-only",
        policy: createAgentPolicy("read-only"),
        policyVersion: 1,
        hostMetadata: {
          hostname: "owner-production-device",
          os: "Ubuntu 24.04 LTS",
          arch: "x86_64",
          platform: "linux",
        },
        createdAt: now,
        updatedAt: now,
      };
      controlPlane.store.insertAgent(ownerAgent);

      const listAgentsSpy = vi.spyOn(controlPlane.store, "listAgents");
      const getAgentByAliasSpy = vi.spyOn(controlPlane.store, "getAgentByAlias");
      const listAuditSpy = vi.spyOn(controlPlane.store, "listAudit");
      const insertActionSpy = vi.spyOn(controlPlane.store, "insertAction");
      const insertAuditSpy = vi.spyOn(controlPlane.store, "insertAudit");
      const dispatchActionSpy = vi.spyOn(
        controlPlane as unknown as { dispatchAction: (...args: unknown[]) => Promise<unknown> },
        "dispatchAction",
      );

      const mcpCall = async (method: string, params?: Record<string, unknown>) => {
        const result = await dispatch(
          controlPlane,
          jsonBodyRequest(
            "POST",
            "/mcp",
            { jsonrpc: "2.0", id: randomToken(6), method, ...(params ? { params } : {}) },
            authorization,
          ),
          "/mcp",
        );
        return JSON.parse(result.response.body) as Record<string, unknown>;
      };

      const toolList = await mcpCall("tools/list");
      const tools = (toolList.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.map((tool) => tool.name)).toEqual([
        "list_hosts",
        "list_agents",
        "get_system_status",
      ]);

      const hostsCall = await mcpCall("tools/call", { name: "list_hosts", arguments: {} });
      const hosts = (hostsCall.result as { structuredContent: Record<string, unknown> })
        .structuredContent;
      expect(hosts).toMatchObject({ sample_data: true, source: "synthetic" });
      expect(hosts.hosts).toHaveLength(2);
      expect(JSON.stringify(hosts)).not.toContain("owner-production-device");

      const agentsCall = await mcpCall("tools/call", { name: "list_agents", arguments: {} });
      const agents = (agentsCall.result as { structuredContent: Record<string, unknown> })
        .structuredContent;
      expect(agents).toMatchObject({ sample_data: true, source: "synthetic" });
      expect(agents.agents).toHaveLength(2);
      expect(JSON.stringify(agents)).not.toContain("owner-production-device");

      const statusCall = await mcpCall("tools/call", {
        name: "get_system_status",
        arguments: { agent_id_or_alias: "reviewer-linux-online" },
      });
      const status = (statusCall.result as { structuredContent: Record<string, unknown> })
        .structuredContent;
      expect(status).toMatchObject({ sample_data: true, source: "synthetic" });
      expect(status.action).toMatchObject({ status: "ok", exit_code: 0, synthetic: true });
      expect((status.action as { stdout: string }).stdout).toContain("SYNTHETIC SAMPLE DATA");

      const offline = await mcpCall("tools/call", {
        name: "get_system_status",
        arguments: { agent_id_or_alias: "reviewer-linux-offline" },
      });
      expect((offline.error as { data: { code: string } }).data.code).toBe("AGENT_OFFLINE");
      const unknown = await mcpCall("tools/call", {
        name: "get_system_status",
        arguments: { agent_id_or_alias: "not-a-sample-device" },
      });
      expect((unknown.error as { data: { code: string } }).data.code).toBe("AGENT_NOT_FOUND");
      const deniedTool = await mcpCall("tools/call", {
        name: "run_shell",
        arguments: { agent_id_or_alias: "owner-production-device", command: "id" },
      });
      expect((deniedTool.error as { data: { code: string } }).data.code).toBe("INVALID_SCOPE");

      const overScopedPrincipal: RemotePrincipal = {
        userId: REVIEWER_DEMO_USER_ID,
        provider: "demo",
        tokenId: "reviewer-over-scoped-test",
        githubId: "",
        githubLogin: "",
        scopes: [...REMOTE_SCOPES],
        capabilities: [...REMOTE_CAPABILITIES],
      };
      const directControlPlane = controlPlane as unknown as {
        callRemoteTool: (
          principal: RemotePrincipal,
          tool: RemoteToolName,
          args: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>;
      };
      await expect(
        directControlPlane.callRemoteTool(overScopedPrincipal, "run_shell", {
          agent_id_or_alias: "owner-production-device",
          command: "id",
        }),
      ).rejects.toMatchObject({ code: "INVALID_SCOPE" });

      expect(listAgentsSpy).not.toHaveBeenCalled();
      expect(getAgentByAliasSpy).not.toHaveBeenCalled();
      expect(listAuditSpy).not.toHaveBeenCalled();
      expect(insertActionSpy).not.toHaveBeenCalled();
      expect(insertAuditSpy).not.toHaveBeenCalled();
      expect(dispatchActionSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      expect(controlPlane.store.listAgents(ownerId)).toHaveLength(1);
      expect(controlPlane.store.listAgents(REVIEWER_DEMO_USER_ID)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects reviewer authorization-code exchange, refresh, and bearer access when disabled", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-disabled-token-boundary-"));
    const enabled = createControlPlane(dir);
    let enabledClosed = false;
    let disabled: RemoteControlPlane | undefined;
    try {
      await enabled.initialize();
      const loginResult = await login(enabled);
      const sessionCookie = setCookie(loginResult.response, "ssh_mcp_reviewer_session")!;
      const registered = await dispatch(
        enabled,
        jsonRequest("POST", "/oauth/register", {
          client_name: "Reviewer Token Boundary",
          redirect_uris: ["http://localhost/reviewer-token-callback"],
        }),
        "/oauth/register",
      );
      const clientId = String(JSON.parse(registered.response.body).client_id);
      const redirectUri = "http://localhost/reviewer-token-callback";
      const issueCode = async () => {
        const authorize = await dispatch(
          enabled,
          request(
            "GET",
            authorizationUrl(clientId, redirectUri, "hosts:read agents:read status:read"),
            { cookie: sessionCookie },
          ),
          "/oauth/authorize",
        );
        const transactionCookie = setCookie(authorize.response, "ssh_mcp_oauth_tx")!;
        const transaction = transactionCookie.slice("ssh_mcp_oauth_tx=".length);
        const approved = await dispatch(
          enabled,
          formRequest(
            "POST",
            "/oauth/approve",
            { transaction, provider: "reviewer_demo" },
            { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${transactionCookie}` },
          ),
          "/oauth/approve",
        );
        const callbackHref = /href="([^"]+)"/u.exec(approved.response.body)?.[1];
        if (!callbackHref)
          throw new Error("Reviewer approval did not return an authorization code");
        return new URL(callbackHref.replaceAll("&amp;", "&")).searchParams.get("code") ?? "";
      };

      const codeForToken = await issueCode();
      const tokenResult = await dispatch(
        enabled,
        formRequest("POST", "/oauth/token", {
          grant_type: "authorization_code",
          client_id: clientId,
          code: codeForToken,
          redirect_uri: redirectUri,
          code_verifier: "reviewer-pkce-verifier",
        }),
        "/oauth/token",
      );
      expect(tokenResult.response.statusCode).toBe(200);
      const tokenBody = JSON.parse(tokenResult.response.body) as Record<string, string>;
      expect(tokenBody.scope).toBe("hosts:read agents:read status:read");
      expect(tokenBody.refresh_token).toBeTruthy();
      const codeAfterDisable = await issueCode();

      enabled.close();
      enabledClosed = true;
      disabled = createControlPlane(dir, false);
      await disabled.initialize();

      const codeExchange = await dispatch(
        disabled,
        formRequest("POST", "/oauth/token", {
          grant_type: "authorization_code",
          client_id: clientId,
          code: codeAfterDisable,
          redirect_uri: redirectUri,
          code_verifier: "reviewer-pkce-verifier",
        }),
        "/oauth/token",
      );
      expect(codeExchange.response.statusCode).toBe(403);

      const refresh = await dispatch(
        disabled,
        formRequest("POST", "/oauth/token", {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokenBody.refresh_token!,
        }),
        "/oauth/token",
      );
      expect(refresh.response.statusCode).toBe(400);
      expect(JSON.parse(refresh.response.body)).toEqual({ error: "invalid_grant" });

      const mcp = await dispatch(
        disabled,
        jsonBodyRequest(
          "POST",
          "/mcp",
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { authorization: `Bearer ${tokenBody.access_token}` },
        ),
        "/mcp",
      );
      expect(mcp.response.statusCode).toBe(401);
    } finally {
      if (!enabledClosed) enabled.close();
      disabled?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("shows only reviewer read-only consent and clamps requested scopes before issuing a code", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-oauth-consent-"));
    const controlPlane = createControlPlane(dir);
    try {
      const loginResult = await login(controlPlane);
      expect(loginResult.response.statusCode).toBe(200);
      const sessionCookie = setCookie(loginResult.response, "ssh_mcp_reviewer_session")!;

      const registered = await dispatch(
        controlPlane,
        jsonRequest("POST", "/oauth/register", {
          client_name: "OpenAI Reviewer Sandbox",
          redirect_uris: ["http://localhost/reviewer-callback"],
        }),
        "/oauth/register",
      );
      expect(registered.response.statusCode).toBe(201);
      const clientId = String(JSON.parse(registered.response.body).client_id);
      const authPath = authorizationUrl(
        clientId,
        "http://localhost/reviewer-callback",
        "hosts:read agents:read status:read logs:read files:write shell:exec",
      );
      const authorize = await dispatch(
        controlPlane,
        request("GET", authPath, { cookie: sessionCookie }),
        "/oauth/authorize",
      );
      expect(authorize.response.statusCode).toBe(200);
      expect(authorize.response.body).toContain("Continue with reviewer sandbox");
      expect(authorize.response.body).toContain("Review sandbox — synthetic data only");
      expect(authorize.response.body).toContain("hosts:read agents:read status:read");
      expect(authorize.response.body).not.toContain("logs:read");
      expect(authorize.response.body).not.toContain("files:write");
      expect(authorize.response.body).not.toContain("shell:exec");
      expect(authorize.response.body).not.toContain("All requested permissions");
      expect(authorize.response.body).not.toContain("Continue with Google");
      expect(authorize.response.body).not.toContain("Continue with GitHub");

      const transactionCookie = setCookie(authorize.response, "ssh_mcp_oauth_tx")!;
      const transaction = transactionCookie.slice("ssh_mcp_oauth_tx=".length);
      const denied = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/approve",
          { transaction, provider: "reviewer_demo" },
          { origin: PUBLIC_BASE_URL, cookie: transactionCookie },
        ),
        "/oauth/approve",
      );
      expect(denied.response.statusCode).toBe(403);

      const deniedWriteOnly = await dispatch(
        controlPlane,
        request(
          "GET",
          authorizationUrl(
            clientId,
            "http://localhost/reviewer-callback",
            "files:write shell:exec",
          ),
          { cookie: sessionCookie },
        ),
        "/oauth/authorize",
      );
      expect(deniedWriteOnly.response.statusCode).toBe(403);

      const approved = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/approve",
          { transaction, provider: "reviewer_demo", grant_mode: "requested" },
          { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${transactionCookie}` },
        ),
        "/oauth/approve",
      );
      expect(approved.response.statusCode).toBe(200);
      const callbackHref = /href="([^"]+)"/u.exec(approved.response.body)?.[1];
      expect(callbackHref).toBeTruthy();
      const callback = new URL(callbackHref!.replaceAll("&amp;", "&"));
      const code = callback.searchParams.get("code");
      expect(code).toBeTruthy();
      expect(callback.searchParams.get("state")).toBe("reviewer-state");
      expect(controlPlane.store.getAuthorizationCodeByHash(hashSecret(code!))).toMatchObject({
        userId: REVIEWER_DEMO_USER_ID,
        scope: "hosts:read agents:read status:read",
      });
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
