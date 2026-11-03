import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { hashSecret, id, randomToken, type JwtKeyPair } from "./crypto.js";
import { capabilitiesFromScopes } from "./scopes.js";
import { addNoStore, readJson, redirect, safeError, sanitizeAgent } from "./http-util.js";
import type { OAuthHandler } from "./oauth-handler.js";
import type { AgentWebSocketHandler } from "./agent-handler.js";
import { RemoteStore } from "./store.js";
import type { AuditEvent, RemoteAgentRecord, RemoteConfig, RemotePrincipal } from "./types.js";
import { REMOTE_SCOPES } from "./types.js";
import { jsonResponse } from "./util.js";
import { renderDashboardHtml } from "./web-dashboard-html.js";
import { createDashboardClientConfigs } from "./web-dashboard-client-config.js";
import { fetchGitHubUserDirect, fetchGoogleUserDirect } from "./web-dashboard-oauth-users.js";

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
    { state: string; provider: "github" | "google"; expiresAt: number; nonce?: string }
  >();

  constructor(private readonly deps: WebDashboardDependencies) {}

  private sessionCookieName = "ssh_mcp_web_session";

  private sessionCookie(value: string, maxAge = 86_400): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${this.sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private authTransactionCookie(state: string, maxAge = 600): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `ssh_mcp_web_tx=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private extractSessionToken(req: IncomingMessage): string | undefined {
    const cookies = (req.headers.cookie ?? "").split(";").map((part) => part.trim());
    const entry = cookies.find((part) => part.startsWith(`${this.sessionCookieName}=`));
    const token = entry?.slice(this.sessionCookieName.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : undefined;
  }

  private matchingAuthTransaction(req: IncomingMessage, state: string): boolean {
    return (req.headers.cookie ?? "")
      .split(";")
      .some((part) => part.trim() === `ssh_mcp_web_tx=${state}`);
  }

  private createWebSession(userId: string): string {
    const token = randomToken(32);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    this.deps.store.createDashboardSession(hashSecret(token), userId, expiresAt, createdAt);
    return this.sessionCookie(token);
  }

  private assertBrowserMutation(req: IncomingMessage): void {
    const expectedOrigin = new URL(this.deps.config.publicBaseUrl).origin;
    const fetchSite = req.headers["sec-fetch-site"];
    if (
      req.headers.origin !== expectedOrigin ||
      req.headers["x-ssh-mcp-dashboard"] !== "1" ||
      (fetchSite !== undefined && fetchSite !== "same-origin")
    ) {
      throw safeError("FORBIDDEN", "Cross-site dashboard mutation is not allowed", 403);
    }
  }

  async getPrincipalFromSession(req: IncomingMessage): Promise<RemotePrincipal | undefined> {
    const token = this.extractSessionToken(req);
    if (!token) return undefined;
    const tokenHash = hashSecret(token);
    const session = this.deps.store.getDashboardSession(tokenHash, new Date().toISOString());
    if (!session) return undefined;
    const user = this.deps.store.getUserById(session.userId);
    if (!user) return undefined;
    const scopes = [...REMOTE_SCOPES];
    return {
      userId: user.id,
      githubId: user.githubId ?? user.googleId ?? user.id,
      githubLogin: user.githubLogin ?? user.displayName,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      scopes,
      capabilities: capabilitiesFromScopes(scopes),
      tokenId: `web_${tokenHash.slice(0, 24)}`,
    };
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
    if (pathname === "/auth/logout" && req.method === "GET") {
      const session = this.extractSessionToken(req);
      if (session) this.deps.store.deleteDashboardSession(hashSecret(session));
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
    // Browser mutations require both exact Origin and a non-simple request header.
    if (["POST", "PATCH", "DELETE"].includes(req.method ?? "")) {
      this.assertBrowserMutation(req);
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
      const webSessionCookie = this.createWebSession(user.id);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": webSessionCookie,
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

    res.setHeader("Set-Cookie", this.authTransactionCookie(state));
    redirect(res, githubUrl.toString());
  }

  private async handleDirectLoginGoogle(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const testGoogle = this.deps.oauth.testGoogleUser();
    if (testGoogle) {
      const user = this.deps.oauth.upsertGoogleUser(testGoogle);
      const webSessionCookie = this.createWebSession(user.id);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": webSessionCookie,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (!this.deps.config.googleClientId || !this.deps.config.googleClientSecret) {
      throw safeError("FORBIDDEN", "Google OAuth is not configured", 503);
    }

    const state = id("webauth");
    const nonce = randomToken(24);
    this.webAuthTransactions.set(state, {
      state,
      provider: "google",
      expiresAt: Date.now() + 600_000,
      nonce,
    });

    const callbackUrl = `${this.deps.config.publicBaseUrl}/auth/callback/google`;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", this.deps.config.googleClientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("state", state);
    googleUrl.searchParams.set("nonce", nonce);

    res.setHeader("Set-Cookie", this.authTransactionCookie(state));
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

    if (
      !code ||
      !tx ||
      tx.expiresAt < Date.now() ||
      tx.provider !== "github" ||
      !this.matchingAuthTransaction(req, state)
    ) {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }

    const githubUser = await fetchGitHubUserDirect(this.deps.config, code);
    const user = this.deps.oauth.upsertGitHubUser(githubUser);
    const webSessionCookie = this.createWebSession(user.id);

    res.writeHead(302, {
      Location: "/dashboard",
      "Set-Cookie": [webSessionCookie, this.authTransactionCookie("", 0)],
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

    if (
      !code ||
      !tx ||
      tx.expiresAt < Date.now() ||
      tx.provider !== "google" ||
      !tx.nonce ||
      !this.matchingAuthTransaction(req, state)
    ) {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }

    const googleUser = await fetchGoogleUserDirect(this.deps.config, code, tx.nonce);
    const user = this.deps.oauth.upsertGoogleUser(googleUser);
    const webSessionCookie = this.createWebSession(user.id);

    res.writeHead(302, {
      Location: "/dashboard",
      "Set-Cookie": [webSessionCookie, this.authTransactionCookie("", 0)],
      "Cache-Control": "no-store",
    });
    res.end();
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

  private quotePosixArg(value: string): string {
    return "'" + value.replaceAll("'", "'\\''") + "'";
  }

  private quotePowerShellArg(value: string): string {
    return "'" + value.replaceAll("'", "''") + "'";
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

    const curlCommand = `curl -fsSL ${this.quotePosixArg(`${serverUrl}/install-agent.sh`)} | bash -s -- --server ${this.quotePosixArg(serverUrl)} --token ${this.quotePosixArg(token)} --alias ${this.quotePosixArg(alias)}`;
    const powershellCommand = `& ([scriptblock]::Create((Invoke-RestMethod -Uri ${this.quotePowerShellArg(`${serverUrl}/install-agent.ps1`)}))) -Server ${this.quotePowerShellArg(serverUrl)} -Token ${this.quotePowerShellArg(token)} -Alias ${this.quotePowerShellArg(alias)}`;
    const npmCommand = `npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll --server ${this.quotePosixArg(serverUrl)} --token ${this.quotePosixArg(token)} --alias ${this.quotePosixArg(alias)} && npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run`;

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
    const configs = createDashboardClientConfigs(
      this.deps.config.publicBaseUrl,
      this.deps.config.mcpResourceUrl,
    );
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
