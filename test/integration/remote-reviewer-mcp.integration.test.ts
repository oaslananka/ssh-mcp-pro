import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { captureResponse, jsonRequest, request } from "../helpers/web-dashboard-fixture.js";
import { describe, expect, test, vi } from "vitest";
import {
  PUBLIC_BASE_URL,
  createControlPlane,
  dispatch,
  setCookie,
  login,
  authorizationUrl,
  jsonBodyRequest,
  formRequest,
} from "../helpers/reviewer-sandbox-fixture.js";

describe("OpenAI reviewer sandbox browser authentication", () => {
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
