import type { IncomingMessage, ServerResponse } from "node:http";
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
import { serveAgentScript } from "./web-dashboard-static.js";
import { createDashboardClientConfigs } from "./web-dashboard-client-config.js";
import { buildDashboardEnrollmentCommands } from "./dashboard-enrollment-commands.js";
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

  private readonly sessionCookieName = "ssh_mcp_web_session";

  private sessionCookie(value: string, maxAge = 86_400): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${this.sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private authTransactionCookie(
    state: string,
    maxAge = 600,
    path: "/auth" | "/oauth" = "/auth",
  ): string {
    const secure = this.deps.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `ssh_mcp_web_tx=${state}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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

  getPrincipalFromSession(req: IncomingMessage): RemotePrincipal | undefined {
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
    if (this.handleScriptRoutes(req, res, pathname)) return true;
    if (await this.handleAuthRoutes(req, res, pathname)) return true;
    if (await this.handleDashboardApiRoutes(req, res, pathname)) return true;
    if (this.handleDashboardPageRoutes(req, res, pathname)) return true;

    return false;
  }

  private handleScriptRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    // 1. Static installation scripts
    if (pathname === "/install-agent.sh" && req.method === "GET") {
      serveAgentScript(res, "scripts/install-agent.sh", "text/x-shellscript; charset=utf-8");
      return true;
    }
    if (pathname === "/install-agent.ps1" && req.method === "GET") {
      serveAgentScript(res, "scripts/install-agent.ps1", "text/plain; charset=utf-8");
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
      this.handleDirectLoginGitHub(req, res);
      return true;
    }
    if (pathname === "/auth/login/google" && req.method === "GET") {
      this.handleDirectLoginGoogle(req, res);
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
      this.handleApiMe(req, res);
      return true;
    }
    if (await this.handleDashboardDeviceRoutes(req, res, pathname)) return true;
    if (pathname === "/api/dashboard/audit" && req.method === "GET") {
      this.handleApiAudit(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/client-configs" && req.method === "GET") {
      this.handleApiClientConfigs(res);
      return true;
    }

    return false;
  }

  private async handleDashboardDeviceRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (pathname === "/api/dashboard/devices" && req.method === "GET") {
      this.handleApiDevices(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/devices/enroll" && req.method === "POST") {
      await this.handleApiEnrollDevice(req, res);
      return true;
    }
    if (
      pathname.startsWith("/api/dashboard/devices/") &&
      pathname.endsWith("/revoke") &&
      req.method === "POST"
    ) {
      this.handleApiRevokeDevice(req, res, pathname.slice(0, -"/revoke".length));
      return true;
    }
    if (pathname.startsWith("/api/dashboard/devices/") && req.method === "PATCH") {
      await this.handleApiUpdateDevicePolicy(req, res, pathname);
      return true;
    }
    if (pathname.startsWith("/api/dashboard/devices/") && req.method === "DELETE") {
      await this.handleApiRemoveDevice(req, res, pathname);
      return true;
    }
    return false;
  }

  private handleDashboardPageRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): boolean {
    // 4. HTML Dashboard & Landing
    if ((pathname === "/" || pathname === "/dashboard") && req.method === "GET") {
      this.serveDashboardHtml(req, res);
      return true;
    }

    return false;
  }

  private handleDirectLoginGitHub(_req: IncomingMessage, res: ServerResponse): void {
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

  private handleDirectLoginGoogle(_req: IncomingMessage, res: ServerResponse): void {
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

    const callbackUrl = this.deps.config.googleCallbackUrl;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", this.deps.config.googleClientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("state", state);
    googleUrl.searchParams.set("nonce", nonce);

    res.setHeader("Set-Cookie", this.authTransactionCookie(state, 600, "/oauth"));
    redirect(res, googleUrl.toString());
  }

  /** Authorization state is one-use even after a rejected callback. */
  private consumeWebAuthTransaction(
    req: IncomingMessage,
    provider: "github" | "google",
  ): { code: string; nonce: string | undefined } {
    const url = new URL(req.url ?? `/auth/callback/${provider}`, this.deps.config.publicBaseUrl);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const transaction = this.webAuthTransactions.get(state);
    this.webAuthTransactions.delete(state);
    if (
      !code ||
      !transaction ||
      transaction.expiresAt < Date.now() ||
      transaction.provider !== provider ||
      (provider === "google" && !transaction.nonce) ||
      !this.matchingAuthTransaction(req, state)
    ) {
      throw safeError("INVALID_TOKEN", "Web login transaction missing or expired", 403);
    }
    return { code, nonce: transaction.nonce };
  }

  private completeWebAuth(
    res: ServerResponse,
    userId: string,
    transactionPath: "/auth" | "/oauth" = "/auth",
  ): void {
    res.writeHead(302, {
      Location: "/dashboard",
      "Set-Cookie": [
        this.createWebSession(userId),
        this.authTransactionCookie("", 0, transactionPath),
      ],
      "Cache-Control": "no-store",
    });
    res.end();
  }

  private async handleDirectCallbackGitHub(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { code } = this.consumeWebAuthTransaction(req, "github");
    const githubUser = await fetchGitHubUserDirect(this.deps.config, code);
    const user = this.deps.oauth.upsertGitHubUser(githubUser);
    this.completeWebAuth(res, user.id);
  }

  /** A dashboard Google login shares the registered MCP Google callback URL. */
  async handleSharedGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const state = new URL(req.url ?? "", this.deps.config.publicBaseUrl).searchParams.get("state");
    // The other flow issues code_<uuid> transactions; never consume those here.
    if (!state || !/^webauth_[0-9a-f]{32}$/u.test(state)) return false;
    await this.handleDirectCallbackGoogle(req, res);
    return true;
  }

  private async handleDirectCallbackGoogle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { code, nonce } = this.consumeWebAuthTransaction(req, "google");
    // Nonce is guaranteed by consumeWebAuthTransaction for Google.
    const googleUser = await fetchGoogleUserDirect(this.deps.config, code, nonce!);
    const user = this.deps.oauth.upsertGoogleUser(googleUser);
    this.completeWebAuth(res, user.id, "/oauth");
  }

  private handleApiMe(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
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

  private handleApiDevices(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
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
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const body = await readJson(req);
    const tokenResult = this.deps.createEnrollmentToken(principal, body);
    const serverUrl = this.deps.config.publicBaseUrl;
    const alias = typeof tokenResult.alias === "string" ? tokenResult.alias : "";
    const token = tokenResult.enrollment_token;
    if (typeof token !== "string" || !token) {
      throw safeError("INVALID_TOKEN", "Enrollment token was not generated", 500);
    }

    const commands = buildDashboardEnrollmentCommands(serverUrl, token, alias);

    jsonResponse(
      res,
      201,
      {
        ...tokenResult,
        commands,
      },
      addNoStore(),
    );
  }

  /** Resolve devices only through the authenticated tenant's ownership boundary. */
  private findOwnedDashboardDevice(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): { principal: RemotePrincipal; agent: RemoteAgentRecord } | undefined {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return undefined;
    }
    const agentId = pathname.slice("/api/dashboard/devices/".length);
    const agent = this.deps.resolveAgent(principal.userId, agentId);
    if (!agent) {
      jsonResponse(res, 404, { error: "Device not found" }, addNoStore());
      return undefined;
    }
    return { principal, agent };
  }

  private async handleApiUpdateDevicePolicy(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const owned = this.findOwnedDashboardDevice(req, res, pathname);
    if (!owned) return;
    const body = await readJson(req);
    const updated = this.deps.updateAgentPolicy(owned.principal, owned.agent, body.policy);
    jsonResponse(res, 200, { device: sanitizeAgent(updated) }, addNoStore());
  }

  /** Revoke access without deleting the inventory or the retained audit trail. */
  private handleApiRevokeDevice(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const owned = this.findOwnedDashboardDevice(req, res, pathname);
    if (!owned) return;
    // Repeated revoke requests should not duplicate audit events.
    const revoked =
      owned.agent.status === "revoked"
        ? owned.agent
        : this.deps.revokeAgent(owned.principal, owned.agent);
    jsonResponse(res, 200, { device: sanitizeAgent(revoked) }, addNoStore());
  }

  private async handleApiRemoveDevice(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const owned = this.findOwnedDashboardDevice(req, res, pathname);
    if (!owned) return;
    // Revoke and disconnect before destroying the agent record or token hashes.
    const revoked =
      owned.agent.status === "revoked"
        ? owned.agent
        : this.deps.revokeAgent(owned.principal, owned.agent);
    if (!this.deps.store.removeRevokedAgent(owned.principal.userId, revoked.id)) {
      throw safeError("AGENT_NOT_FOUND", "Device not found", 404);
    }
    this.deps.audit({
      userId: owned.principal.userId,
      agentId: revoked.id,
      eventType: "agent_removed",
      severity: "warn",
      metadata: {},
    });
    jsonResponse(res, 200, { removed: true, agent_id: revoked.id }, addNoStore());
  }

  private handleApiAudit(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
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

  private serveDashboardHtml(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
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
    const mcpUrlJson = JSON.stringify(this.deps.config.mcpResourceUrl).replaceAll(
      "<",
      String.raw`\u003c`,
    );
    const publicUrlJson = JSON.stringify(this.deps.config.publicBaseUrl).replaceAll(
      "<",
      String.raw`\u003c`,
    );

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
