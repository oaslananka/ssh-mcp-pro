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
import { renderDashboardHtml } from "./web-dashboard-html.js";

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
    if (await this.handleScriptRoutes(req, res, pathname)) return true;
    if (await this.handleAuthRoutes(req, res, pathname)) return true;
    if (await this.handleDashboardApiRoutes(req, res, pathname)) return true;
    if (await this.handleDashboardPageRoutes(req, res, pathname)) return true;

    return false;
  }

  private async handleScriptRoutes(
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

    return false;
  }

  private async handleAuthRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
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

    return false;
  }

  private async handleDashboardApiRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
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

    return false;
  }

  private async handleDashboardPageRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
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

    // Base64 keeps untrusted user fields out of executable JavaScript syntax.
    const initialUserBase64 = Buffer.from(initialUserJson, "utf8").toString("base64");
    const mcpUrlJson = JSON.stringify(this.deps.config.mcpResourceUrl).replaceAll("<", "\\u003c");
    const publicUrlJson = JSON.stringify(this.deps.config.publicBaseUrl).replaceAll("<", "\\u003c");

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(renderDashboardHtml(initialUserBase64, mcpUrlJson, publicUrlJson));
  }
}
