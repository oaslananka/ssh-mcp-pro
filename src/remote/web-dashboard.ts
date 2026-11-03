import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { id, issueAccessToken, verifyRemoteAccessToken, type JwtKeyPair } from "./crypto.js";
import { addNoStore, asString, readJson, redirect, safeError, sanitizeAgent } from "./http-util.js";
import type { OAuthHandler } from "./oauth-handler.js";
import type { AgentWebSocketHandler } from "./agent-handler.js";
import { RemoteStore } from "./store.js";
import type {
  AuditEvent,
  GitHubUser,
  GoogleUser,
  RemoteAgentRecord,
  RemoteConfig,
  RemotePrincipal,
} from "./types.js";
import { REMOTE_SCOPES } from "./types.js";
import { jsonResponse } from "./util.js";

export interface WebDashboardDependencies {
  config: RemoteConfig;
  store: RemoteStore;
  oauth: OAuthHandler;
  agentHandler: AgentWebSocketHandler;
  getJwtKeyPair: () => JwtKeyPair;
  audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void;
  createEnrollmentToken: (
    principal: RemotePrincipal,
    args: Record<string, unknown>,
  ) => Record<string, unknown>;
  updateAgentPolicy: (
    principal: RemotePrincipal,
    agent: RemoteAgentRecord,
    policyInput: unknown,
  ) => RemoteAgentRecord;
  revokeAgent: (principal: RemotePrincipal, agent: RemoteAgentRecord) => RemoteAgentRecord;
  resolveAgent: (userId: string, value: string) => RemoteAgentRecord | undefined;
}

export class WebDashboardHandler {
  private readonly webAuthTransactions = new Map<
    string,
    { state: string; provider: "github" | "google"; expiresAt: number }
  >();

  constructor(private readonly deps: WebDashboardDependencies) {}

  private sessionCookieName = "ssh_mcp_web_session";

  private sessionCookie(value: string, maxAge = 86_400): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${this.sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private extractSessionToken(req: IncomingMessage): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim();
    }
    const cookieHeader = req.headers.cookie ?? "";
    const cookies = cookieHeader.split(";").map((part) => part.trim());
    for (const c of cookies) {
      if (c.startsWith(`${this.sessionCookieName}=`)) {
        return decodeURIComponent(c.slice(this.sessionCookieName.length + 1));
      }
    }
    return undefined;
  }

  async getPrincipalFromSession(req: IncomingMessage): Promise<RemotePrincipal | undefined> {
    const token = this.extractSessionToken(req);
    if (!token) {
      return undefined;
    }
    try {
      return await verifyRemoteAccessToken(
        `Bearer ${token}`,
        this.deps.config,
        this.deps.getJwtKeyPair(),
      );
    } catch {
      return undefined;
    }
  }

  /** Handle routes for web UI, authentication, dashboard APIs, and agent scripts. */
  async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // 1. Static installation scripts
    if (pathname === "/install-agent.sh" && req.method === "GET") {
      this.serveScript(res, "scripts/install-agent.sh", "text/x-shellscript; charset=utf-8");
      return true;
    }
    if (pathname === "/install-agent.ps1" && req.method === "GET") {
      this.serveScript(res, "scripts/install-agent.ps1", "text/plain; charset=utf-8");
      return true;
    }

    // 2. Web direct auth endpoints
    if (pathname === "/auth/login/github" && req.method === "GET") {
      await this.handleDirectLoginGitHub(req, res);
      return true;
    }
    if (pathname === "/auth/login/google" && req.method === "GET") {
      await this.handleDirectLoginGoogle(req, res);
      return true;
    }
    if (pathname === "/auth/callback/github" && req.method === "GET") {
      await this.handleDirectCallbackGitHub(req, res);
      return true;
    }
    if (pathname === "/auth/callback/google" && req.method === "GET") {
      await this.handleDirectCallbackGoogle(req, res);
      return true;
    }
    if (pathname === "/auth/logout") {
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": this.sessionCookie("", 0),
        "Cache-Control": "no-store",
      });
      res.end();
      return true;
    }

    // 3. Web Dashboard REST APIs
    if (pathname === "/api/dashboard/me" && req.method === "GET") {
      await this.handleApiMe(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/devices" && req.method === "GET") {
      await this.handleApiDevices(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/devices/enroll" && req.method === "POST") {
      await this.handleApiEnrollDevice(req, res);
      return true;
    }
    if (pathname.startsWith("/api/dashboard/devices/") && req.method === "PATCH") {
      await this.handleApiUpdateDevicePolicy(req, res, pathname);
      return true;
    }
    if (pathname.startsWith("/api/dashboard/devices/") && req.method === "DELETE") {
      await this.handleApiRevokeDevice(req, res, pathname);
      return true;
    }
    if (pathname === "/api/dashboard/audit" && req.method === "GET") {
      await this.handleApiAudit(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/client-configs" && req.method === "GET") {
      this.handleApiClientConfigs(res);
      return true;
    }

    // 4. HTML Dashboard & Landing
    if ((pathname === "/" || pathname === "/dashboard") && req.method === "GET") {
      await this.serveDashboardHtml(req, res);
      return true;
    }

    return false;
  }

  private serveScript(res: ServerResponse, relativePath: string, contentType: string): void {
    const fullPath = path.resolve(relativePath);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf8");
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(content);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Script file not found on server");
    }
  }

  private async handleDirectLoginGitHub(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const testUser = this.deps.oauth.testGitHubUser();
    if (testUser) {
      const user = this.deps.oauth.upsertGitHubUser(testUser);
      const token = await issueAccessToken(this.deps.config, this.deps.getJwtKeyPair(), user, [
        ...REMOTE_SCOPES,
      ]);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": this.sessionCookie(token.token),
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (!this.deps.config.githubClientId || !this.deps.config.githubClientSecret) {
      throw safeError("FORBIDDEN", "GitHub OAuth is not configured", 503);
    }

    const state = id("webauth");
    this.webAuthTransactions.set(state, {
      state,
      provider: "github",
      expiresAt: Date.now() + 600_000,
    });

    const callbackUrl = `${this.deps.config.publicBaseUrl}/auth/callback/github`;
    const githubUrl = new URL("https://github.com/login/oauth/authorize");
    githubUrl.searchParams.set("client_id", this.deps.config.githubClientId);
    githubUrl.searchParams.set("redirect_uri", callbackUrl);
    githubUrl.searchParams.set("scope", "read:user");
    githubUrl.searchParams.set("state", state);

    redirect(res, githubUrl.toString());
  }

  private async handleDirectLoginGoogle(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const testGoogle = this.deps.oauth.testGoogleUser();
    if (testGoogle) {
      const user = this.deps.oauth.upsertGoogleUser(testGoogle);
      const token = await issueAccessToken(this.deps.config, this.deps.getJwtKeyPair(), user, [
        ...REMOTE_SCOPES,
      ]);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": this.sessionCookie(token.token),
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (!this.deps.config.googleClientId || !this.deps.config.googleClientSecret) {
      throw safeError("FORBIDDEN", "Google OAuth is not configured", 503);
    }

    const state = id("webauth");
    this.webAuthTransactions.set(state, {
      state,
      provider: "google",
      expiresAt: Date.now() + 600_000,
    });

    const callbackUrl = `${this.deps.config.publicBaseUrl}/auth/callback/google`;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", this.deps.config.googleClientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("state", state);

    redirect(res, googleUrl.toString());
  }

  private async handleDirectCallbackGitHub(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/auth/callback/github", this.deps.config.publicBaseUrl);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const tx = this.webAuthTransactions.get(state);
    this.webAuthTransactions.delete(state);

    if (!code || !tx || tx.expiresAt < Date.now() || tx.provider !== "github") {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }

    const githubUser = await this.fetchGitHubUserDirect(code);
    const user = this.deps.oauth.upsertGitHubUser(githubUser);
    const token = await issueAccessToken(this.deps.config, this.deps.getJwtKeyPair(), user, [
      ...REMOTE_SCOPES,
    ]);

    res.writeHead(302, {
      Location: "/dashboard",
      "Set-Cookie": this.sessionCookie(token.token),
      "Cache-Control": "no-store",
    });
    res.end();
  }

  private async handleDirectCallbackGoogle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/auth/callback/google", this.deps.config.publicBaseUrl);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const tx = this.webAuthTransactions.get(state);
    this.webAuthTransactions.delete(state);

    if (!code || !tx || tx.expiresAt < Date.now() || tx.provider !== "google") {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }

    const googleUser = await this.fetchGoogleUserDirect(code);
    const user = this.deps.oauth.upsertGoogleUser(googleUser);
    const token = await issueAccessToken(this.deps.config, this.deps.getJwtKeyPair(), user, [
      ...REMOTE_SCOPES,
    ]);

    res.writeHead(302, {
      Location: "/dashboard",
      "Set-Cookie": this.sessionCookie(token.token),
      "Cache-Control": "no-store",
    });
    res.end();
  }

  private async fetchGitHubUserDirect(code: string): Promise<GitHubUser> {
    const callbackUrl = `${this.deps.config.publicBaseUrl}/auth/callback/github`;
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.deps.config.githubClientId,
        client_secret: this.deps.config.githubClientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });
    const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = asString(tokenPayload.access_token);
    if (!accessToken) {
      throw safeError("INVALID_TOKEN", "GitHub OAuth token exchange failed", 502);
    }
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    });
    const userPayload = (await userResponse.json()) as Record<string, unknown>;
    const githubId = userPayload.id;
    const githubLogin = userPayload.login;
    if (typeof githubId !== "number" || typeof githubLogin !== "string" || !githubLogin) {
      throw safeError("INVALID_TOKEN", "GitHub user response missing valid identity", 502);
    }
    return { id: String(githubId), login: githubLogin };
  }

  private async fetchGoogleUserDirect(code: string): Promise<GoogleUser> {
    const callbackUrl = `${this.deps.config.publicBaseUrl}/auth/callback/google`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.deps.config.googleClientId ?? "",
        client_secret: this.deps.config.googleClientSecret ?? "",
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }).toString(),
    });
    const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = asString(tokenPayload.access_token);
    if (!accessToken) {
      throw safeError("INVALID_TOKEN", "Google OAuth token exchange failed", 502);
    }
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userPayload = (await userResponse.json()) as Record<string, unknown>;
    const sub = asString(userPayload.sub);
    const email = asString(userPayload.email);
    const name = asString(userPayload.name) ?? email ?? "Google User";
    const picture = asString(userPayload.picture);
    if (!sub || !email) {
      throw safeError("INVALID_TOKEN", "Google user response missing identity", 502);
    }
    return { id: sub, email, name, picture };
  }

  private async handleApiMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 200, { authenticated: false }, addNoStore());
      return;
    }
    const user = this.deps.store.getUserById(principal.userId);
    jsonResponse(
      res,
      200,
      {
        authenticated: true,
        user: {
          id: principal.userId,
          displayName: user?.displayName ?? principal.displayName ?? principal.githubLogin,
          email: user?.email ?? principal.email,
          provider: user?.provider ?? principal.provider ?? "github",
          scopes: principal.scopes,
        },
      },
      addNoStore(),
    );
  }

  private async handleApiDevices(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const agents = this.deps.store.listAgents(principal.userId);
    const enriched = agents.map((agent) => {
      const sanitized = sanitizeAgent(agent);
      const isOnline = this.deps.agentHandler.isAgentOnline(agent.id);
      return {
        ...sanitized,
        isLiveConnected: isOnline,
        status: isOnline ? "online" : sanitized.status,
      };
    });
    jsonResponse(res, 200, { devices: enriched }, addNoStore());
  }

  private async handleApiEnrollDevice(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const body = await readJson(req);
    const tokenResult = this.deps.createEnrollmentToken(principal, body);
    const serverUrl = this.deps.config.publicBaseUrl;
    const alias = String(tokenResult.alias ?? "");
    const token = String(tokenResult.token ?? "");

    const curlCommand = `curl -fsSL ${serverUrl}/install-agent.sh | bash -s -- --server ${serverUrl} --token ${token} --alias ${alias}`;
    const powershellCommand = `irm ${serverUrl}/install-agent.ps1 | iex; install-agent -Server ${serverUrl} -Token ${token} -Alias ${alias}`;
    const npmCommand = `npx ssh-mcp-pro-agent enroll --server ${serverUrl} --token ${token} --alias ${alias} && npx ssh-mcp-pro-agent run`;

    jsonResponse(
      res,
      201,
      {
        ...tokenResult,
        commands: {
          linux: curlCommand,
          windows: powershellCommand,
          npm: npmCommand,
        },
      },
      addNoStore(),
    );
  }

  private async handleApiUpdateDevicePolicy(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const agentId = pathname.slice("/api/dashboard/devices/".length);
    const agent = this.deps.resolveAgent(principal.userId, agentId);
    if (!agent) {
      jsonResponse(res, 404, { error: "Device not found" }, addNoStore());
      return;
    }
    const body = await readJson(req);
    const updated = this.deps.updateAgentPolicy(principal, agent, body.policy);
    jsonResponse(res, 200, { device: sanitizeAgent(updated) }, addNoStore());
  }

  private async handleApiRevokeDevice(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const agentId = pathname.slice("/api/dashboard/devices/".length);
    const agent = this.deps.resolveAgent(principal.userId, agentId);
    if (!agent) {
      jsonResponse(res, 404, { error: "Device not found" }, addNoStore());
      return;
    }
    const revoked = this.deps.revokeAgent(principal, agent);
    jsonResponse(res, 200, { device: sanitizeAgent(revoked) }, addNoStore());
  }

  private async handleApiAudit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const events = this.deps.store.listAudit(principal.userId, undefined, 50);
    jsonResponse(res, 200, { events }, addNoStore());
  }

  private handleApiClientConfigs(res: ServerResponse): void {
    const publicUrl = this.deps.config.publicBaseUrl;
    const mcpUrl = this.deps.config.mcpResourceUrl;

    const configs = {
      endpoints: {
        webEndpoint: mcpUrl,
        publicBaseUrl: publicUrl,
        transport: "streamable-http",
        auth: "OAuth 2.1 PKCE (RFC 9728 & RFC 8414)",
      },
      clients: {
        claudeDesktopRemote: {
          mcpServers: {
            "ssh-mcp-pro": {
              url: mcpUrl,
              transport: "streamable-http",
            },
          },
        },
        claudeDesktopLocal: {
          mcpServers: {
            "ssh-mcp-pro": {
              command: "ssh-mcp-pro",
              args: [],
            },
          },
        },
        chatgptCustomGpt: {
          actionServerUrl: mcpUrl,
          authentication: "OAuth 2.0 (Authorization Code + PKCE)",
          authorizationUrl: `${publicUrl}/oauth/authorize`,
          tokenUrl: `${publicUrl}/oauth/token`,
          scope: "hosts:read agents:read status:read logs:read",
        },
        geminiExtension: {
          mcpEndpoint: mcpUrl,
          transport: "streamable-http",
          auth: "OAuth 2.1 (RFC 9728 discovery)",
        },
        vscodeCursor: {
          "mcp.servers": {
            "ssh-mcp-pro-cloud": {
              type: "streamable-http",
              url: mcpUrl,
            },
            "ssh-mcp-pro-local": {
              type: "stdio",
              command: "ssh-mcp-pro",
              args: [],
            },
          },
        },
      },
    };
    jsonResponse(res, 200, configs, addNoStore());
  }

  private async serveDashboardHtml(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const principal = await this.getPrincipalFromSession(req);
    const user = principal ? this.deps.store.getUserById(principal.userId) : undefined;
    const initialUserJson = JSON.stringify(
      principal
        ? {
            id: principal.userId,
            displayName: user?.displayName ?? principal.displayName ?? principal.githubLogin,
            email: user?.email ?? principal.email,
            provider: user?.provider ?? principal.provider ?? "github",
          }
        : null,
    );

    const mcpUrl = this.deps.config.mcpResourceUrl;
    const publicUrl = this.deps.config.publicBaseUrl;

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ssh-mcp-pro | Secure SSH MCP Platform</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --primary: #238636;
      --primary-hover: #2ea043;
      --blue: #58a6ff;
      --blue-bg: rgba(56, 139, 253, 0.15);
      --red: #f85149;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding-bottom: 60px;
    }
    header {
      background: #161b22;
      border-bottom: 1px solid var(--card-border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .logo-area { display: flex; align-items: center; gap: 12px; }
    .logo-icon { font-size: 24px; }
    .brand-title { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    .brand-sub { font-size: 12px; color: var(--text-muted); }
    .user-area { display: flex; align-items: center; gap: 16px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-green { background: #238636; color: #fff; }
    .badge-gray { background: #30363d; color: #8b949e; }
    .badge-blue { background: var(--blue-bg); color: var(--blue); border: 1px solid rgba(56,139,253,0.3); }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }
    .btn-primary { background: var(--primary); color: #fff; border-color: rgba(240,246,252,0.1); }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-outline { background: transparent; color: var(--text-main); border-color: var(--card-border); }
    .btn-outline:hover { background: #21262d; border-color: #8b949e; }
    .btn-danger { background: rgba(248,81,73,0.1); color: var(--red); border-color: rgba(248,81,73,0.4); }
    .btn-danger:hover { background: var(--red); color: #fff; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }

    .container { max-width: 1100px; margin: 32px auto; padding: 0 20px; }

    /* Hero banner */
    .hero {
      background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 48px 32px;
      text-align: center;
      margin-bottom: 32px;
    }
    .hero h1 { font-size: 32px; font-weight: 800; margin-bottom: 12px; color: #fff; }
    .hero p { font-size: 16px; color: var(--text-muted); max-width: 650px; margin: 0 auto 28px; }
    .auth-buttons { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
    .auth-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      border: 1px solid transparent;
      transition: transform 0.15s ease;
    }
    .auth-btn:hover { transform: translateY(-2px); }
    .auth-btn-google { background: #ffffff; color: #1f2937; border-color: #d1d5db; }
    .auth-btn-github { background: #24292f; color: #ffffff; border-color: #30363d; }

    /* Tab nav */
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--card-border); margin-bottom: 24px; }
    .tab-item {
      padding: 12px 20px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      color: var(--text-muted);
      border-bottom: 2px solid transparent;
      transition: color 0.15s ease;
    }
    .tab-item.active { color: var(--blue); border-bottom-color: var(--blue); }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* Device Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .device-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    .device-info { display: flex; align-items: center; gap: 16px; }
    .device-icon {
      font-size: 28px;
      width: 48px;
      height: 48px;
      background: #21262d;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .device-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
    .device-meta { font-size: 13px; color: var(--text-muted); font-family: var(--font-mono); }

    /* Code block */
    .code-box {
      background: #090d13;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 14px 18px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: #7ee787;
      overflow-x: auto;
      margin: 12px 0;
      position: relative;
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 8px;
      font-size: 11px;
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 4px;
      cursor: pointer;
    }
    .copy-btn:hover { background: #30363d; color: #fff; }

    /* Config guide cards */
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }

    /* Empty state */
    .empty-box {
      text-align: center;
      padding: 48px 16px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-area">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="brand-title">ssh-mcp-pro</div>
        <div class="brand-sub">Model Context Protocol SSH Gateway</div>
      </div>
    </div>
    <div class="user-area" id="headerUserArea"></div>
  </header>

  <div class="container" id="appRoot">
    <!-- Rendered by client script based on currentUser -->
  </div>

  <script>
    const INITIAL_USER = ${initialUserJson};
    const MCP_URL = "${mcpUrl}";
    const PUBLIC_URL = "${publicUrl}";

    let currentUser = INITIAL_USER;
    let activeTab = 'devices';
    let devicesList = [];
    let auditList = [];

    function renderHeader() {
      const container = document.getElementById('headerUserArea');
      if (currentUser) {
        container.innerHTML = \`
          <span class="badge badge-green">Connected</span>
          <span style="font-size: 14px; font-weight: 600;">\${currentUser.displayName || currentUser.id}</span>
          <span class="badge badge-blue">\${currentUser.provider}</span>
          <a href="/auth/logout" class="btn btn-outline btn-sm">Sign out</a>
        \`;
      } else {
        container.innerHTML = \`
          <a href="/auth/login/google" class="btn btn-outline btn-sm">Sign In</a>
        \`;
      }
    }

    function renderApp() {
      const root = document.getElementById('appRoot');
      if (!currentUser) {
        root.innerHTML = renderLanding();
        return;
      }

      root.innerHTML = \`
        <div class="card" style="margin-bottom: 24px; background: linear-gradient(90deg, #161b22 0%, #1f242c 100%);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <div style="font-size:12px; text-transform:uppercase; font-weight:700; color:var(--blue); margin-bottom:4px;">Remote MCP Endpoint</div>
              <div style="font-family:var(--font-mono); font-size:15px; color:#fff; font-weight:600;">\${MCP_URL}</div>
              <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">Transport: Streamable HTTP • Auth: OAuth 2.1 PKCE (RFC 9728 & RFC 8414)</div>
            </div>
            <button class="btn btn-primary" onclick="switchTab('add-device')">➕ Add New Device</button>
          </div>
        </div>

        <div class="tabs">
          <div class="tab-item \${activeTab === 'devices' ? 'active' : ''}" onclick="switchTab('devices')">🖥️ Enrolled Devices</div>
          <div class="tab-item \${activeTab === 'add-device' ? 'active' : ''}" onclick="switchTab('add-device')">➕ Add Device</div>
          <div class="tab-item \${activeTab === 'clients' ? 'active' : ''}" onclick="switchTab('clients')">🤖 AI Integrations</div>
          <div class="tab-item \${activeTab === 'audit' ? 'active' : ''}" onclick="switchTab('audit')">📜 Audit Log</div>
        </div>

        <div id="tabContent">
          \${renderTabContent()}
        </div>
      \`;

      if (activeTab === 'devices') loadDevices();
      if (activeTab === 'audit') loadAudit();
    }

    function switchTab(tab) {
      activeTab = tab;
      renderApp();
    }

    function renderLanding() {
      return \`
        <div class="hero">
          <div style="font-size: 48px; margin-bottom: 12px;">🛡️⚡</div>
          <h1>ssh-mcp-pro Gateway</h1>
          <p>Zero-Trust Model Context Protocol SSH Gateway with policy controls, biometric & OAuth 2.1 authentication, and dual local/remote agent support.</p>
          <div class="auth-buttons">
            <a href="/auth/login/google" class="auth-btn auth-btn-google">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.7 0 3 .7 3.9 1.5l2.9-2.9C17 2 14.7 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.5 1.9 7.8l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.3 7.5 23.5 12 23.5z"/></svg>
              Sign in with Google
            </a>
            <a href="/auth/login/github" class="auth-btn auth-btn-github">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              Sign in with GitHub
            </a>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <h3 style="margin-bottom:8px; color:var(--blue);">🌐 Remote Streamable HTTP (OAuth 2.1)</h3>
            <p style="font-size:14px; color:var(--text-muted); margin-bottom:12px;">Connect AI clients (ChatGPT Actions, Claude Desktop, Gemini) through a single HTTPS endpoint with cryptographic policy enforcement.</p>
            <div class="code-box">\${MCP_URL}</div>
          </div>
          <div class="card">
            <h3 style="margin-bottom:8px; color:#7ee787;">💻 Local Stdio Mode (Unrestricted)</h3>
            <p style="font-size:14px; color:var(--text-muted); margin-bottom:12px;">No cloud dependencies, zero limits. Run ssh-mcp-pro locally with your own OpenSSH keys and config.</p>
            <div class="code-box">npx ssh-mcp-pro</div>
          </div>
        </div>
      \`;
    }

    function renderTabContent() {
      if (activeTab === 'devices') {
        if (devicesList.length === 0) {
          return \`
            <div class="card empty-box">
              <div style="font-size:40px; margin-bottom:12px;">🖥️</div>
              <h3 style="margin-bottom:8px;">No devices enrolled yet</h3>
              <p style="margin-bottom:20px;">Enroll your first server, VM, or local workstation to control it safely through MCP.</p>
              <button class="btn btn-primary" onclick="switchTab('add-device')">Enroll a Device</button>
            </div>
          \`;
        }
        return devicesList.map(dev => \`
          <div class="card">
            <div class="device-row">
              <div class="device-info">
                <div class="device-icon">\${dev.hostMetadata?.platform === 'win32' ? '🪟' : (dev.hostMetadata?.platform === 'darwin' ? '🍎' : '🐧')}</div>
                <div>
                  <div class="device-name">
                    \${dev.alias}
                    <span class="badge \${dev.isLiveConnected ? 'badge-green' : 'badge-gray'}">\${dev.isLiveConnected ? '🟢 Live Online' : dev.status}</span>
                    <span class="badge badge-blue">\${dev.profile}</span>
                  </div>
                  <div class="device-meta">
                    Host: \${dev.hostMetadata?.hostname || 'Unknown'} | Arch: \${dev.hostMetadata?.arch || 'Unknown'} | Policy v\${dev.policyVersion}
                  </div>
                </div>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                <select class="btn btn-outline btn-sm" onchange="changePolicy('\${dev.id}', this.value)">
                  <option value="read-only" \${dev.profile === 'read-only' ? 'selected' : ''}>Profile: Read-Only</option>
                  <option value="operations" \${dev.profile === 'operations' ? 'selected' : ''}>Profile: Operations</option>
                  <option value="full-admin" \${dev.profile === 'full-admin' ? 'selected' : ''}>Profile: Full Admin</option>
                </select>
                <button class="btn btn-danger btn-sm" onclick="revokeDevice('\${dev.id}')">Revoke</button>
              </div>
            </div>
          </div>
        \`).join('');
      }

      if (activeTab === 'add-device') {
        return \`
          <div class="card">
            <h2 style="margin-bottom:12px;">Enroll New Device</h2>
            <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">Generate an enrollment token and install the outbound agent on your target server.</p>
            <div style="display:flex; gap:16px; margin-bottom:24px; flex-wrap:wrap;">
              <div style="flex:1; min-width:240px;">
                <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Device Alias</label>
                <input id="enrollAlias" type="text" placeholder="e.g. production-bastion, home-server" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
              </div>
              <div style="flex:1; min-width:240px;">
                <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Initial Policy Profile</label>
                <select id="enrollProfile" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
                  <option value="read-only">Read-Only (Status, Logs, Read Files)</option>
                  <option value="operations" selected>Operations (Restart Services, Docker, Safe Shell)</option>
                  <option value="full-admin">Full Admin (Root sudo, File Write, Service Admin)</option>
                </select>
              </div>
            </div>
            <button class="btn btn-primary" onclick="generateEnrollment()">Generate Install Command</button>

            <div id="enrollOutput" style="margin-top:24px; display:none;">
              <h3 style="margin-bottom:12px; color:#fff;">One-Liner Installation Commands:</h3>

              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🐧 Linux / macOS (Bash)</div>
                <div class="code-box">
                  <button class="copy-btn" onclick="copySnippet('cmdLinux')">Copy</button>
                  <span id="cmdLinux"></span>
                </div>
              </div>

              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🪟 Windows (PowerShell)</div>
                <div class="code-box">
                  <button class="copy-btn" onclick="copySnippet('cmdWindows')">Copy</button>
                  <span id="cmdWindows"></span>
                </div>
              </div>

              <div>
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">📦 Standalone NPM (Cross-platform)</div>
                <div class="code-box">
                  <button class="copy-btn" onclick="copySnippet('cmdNpm')">Copy</button>
                  <span id="cmdNpm"></span>
                </div>
              </div>
            </div>
          </div>
        \`;
      }

      if (activeTab === 'clients') {
        return \`
          <div class="grid-2">
            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">🤖</span>
                <h3>Claude Desktop & Claude Code</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Add this server to your <code>claude_desktop_config.json</code>:</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue);">Remote Streamable HTTP (OAuth 2.1):</div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgClaudeRemote')">Copy</button><span id="cfgClaudeRemote">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "url": "\${MCP_URL}",\\n      "transport": "streamable-http"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:#7ee787; margin-top:12px;">Local Stdio (Unrestricted):</div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgClaudeLocal')">Copy</button><span id="cfgClaudeLocal">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "command": "ssh-mcp-pro",\\n      "args": []\\n    }\\n  }\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💬</span>
                <h3>ChatGPT Actions / MCP Connector</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Connect in ChatGPT Custom GPTs or Connected Apps using the OAuth 2.1 Authorization Code flow:</p>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgChatGpt')">Copy</button><span id="cfgChatGpt">Server URL: \${MCP_URL}\\nAuthorization URL: \${PUBLIC_URL}/oauth/authorize\\nToken URL: \${PUBLIC_URL}/oauth/token\\nScope: hosts:read agents:read status:read logs:read</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">✨</span>
                <h3>Google Gemini / Vertex AI</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Add as an external MCP tool in Gemini API or Extensions:</p>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgGemini')">Copy</button><span id="cfgGemini">{\\n  "name": "ssh-mcp-pro",\\n  "endpoint": "\${MCP_URL}",\\n  "protocol": "streamable-http",\\n  "auth": "oauth2"\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💻</span>
                <h3>VS Code / Cursor / Windsurf</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Add to your workspace <code>.vscode/mcp.json</code>:</p>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgVsCode')">Copy</button><span id="cfgVsCode">{\\n  "mcp.servers": {\\n    "ssh-mcp-pro": {\\n      "type": "streamable-http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
            </div>
          </div>
        \`;
      }

      if (activeTab === 'audit') {
        if (auditList.length === 0) {
          return '<div class="card empty-box">No audit events recorded yet.</div>';
        }
        return \`
          <div class="card" style="padding:0; overflow:hidden;">
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
              <thead style="background:#21262d; border-bottom:1px solid var(--card-border);">
                <tr>
                  <th style="padding:12px 16px;">Timestamp</th>
                  <th style="padding:12px 16px;">Event</th>
                  <th style="padding:12px 16px;">Severity</th>
                  <th style="padding:12px 16px;">Target</th>
                </tr>
              </thead>
              <tbody>
                \${auditList.map(e => \`
                  <tr style="border-bottom:1px solid #21262d;">
                    <td style="padding:12px 16px; font-family:var(--font-mono); color:var(--text-muted);">\${new Date(e.createdAt).toLocaleTimeString()}</td>
                    <td style="padding:12px 16px; font-weight:600;">\${e.eventType}</td>
                    <td style="padding:12px 16px;"><span class="badge \${e.severity === 'info' ? 'badge-blue' : (e.severity === 'warn' ? 'badge-green' : 'badge-gray')}">\${e.severity}</span></td>
                    <td style="padding:12px 16px; font-family:var(--font-mono); color:var(--text-muted);">\${e.agentId || e.actionId || '-'}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \`;
      }
    }

    async function loadDevices() {
      try {
        const res = await fetch('/api/dashboard/devices');
        if (res.ok) {
          const data = await res.json();
          devicesList = data.devices || [];
          const tabContent = document.getElementById('tabContent');
          if (activeTab === 'devices' && tabContent) {
            tabContent.innerHTML = renderTabContent();
          }
        }
      } catch (e) {
        console.error('Failed to load devices', e);
      }
    }

    async function loadAudit() {
      try {
        const res = await fetch('/api/dashboard/audit');
        if (res.ok) {
          const data = await res.json();
          auditList = data.events || [];
          const tabContent = document.getElementById('tabContent');
          if (activeTab === 'audit' && tabContent) {
            tabContent.innerHTML = renderTabContent();
          }
        }
      } catch (e) {
        console.error('Failed to load audit events', e);
      }
    }

    async function generateEnrollment() {
      const alias = document.getElementById('enrollAlias').value.trim() || 'server-' + Math.floor(Math.random() * 1000);
      const profile = document.getElementById('enrollProfile').value;
      try {
        const res = await fetch('/api/dashboard/devices/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias, requested_profile: profile })
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('cmdLinux').textContent = data.commands.linux;
          document.getElementById('cmdWindows').textContent = data.commands.windows;
          document.getElementById('cmdNpm').textContent = data.commands.npm;
          document.getElementById('enrollOutput').style.display = 'block';
        } else {
          alert('Failed to generate enrollment token.');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function changePolicy(id, profile) {
      try {
        const res = await fetch('/api/dashboard/devices/' + id + '/policy', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policy: { profile } })
        });
        if (res.ok) {
          loadDevices();
        } else {
          alert('Failed to update policy');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function revokeDevice(id) {
      if (!confirm('Revoke this device? The agent will be disconnected and unable to reconnect.')) return;
      try {
        const res = await fetch('/api/dashboard/devices/' + id, {
          method: 'DELETE'
        });
        if (res.ok) {
          loadDevices();
        } else {
          alert('Failed to revoke device');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    function copySnippet(id) {
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
      });
    }

    renderHeader();
    renderApp();
  </script>
</body>
</html>`);
  }
}
