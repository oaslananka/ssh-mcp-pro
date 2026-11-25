import type { IncomingMessage, ServerResponse } from "node:http";
import type { JwtKeyPair } from "./crypto.js";
import { addNoStore, readJson, safeError, sanitizeAgent } from "./http-util.js";
import type { OAuthHandler } from "./oauth-handler.js";
import type { AgentWebSocketHandler } from "./agent-handler.js";
import { RemoteStore } from "./store.js";
import type { AuditEvent, RemoteAgentRecord, RemoteConfig, RemotePrincipal } from "./types.js";
import { jsonResponse } from "./util.js";
import { renderDashboardHtml } from "./web-dashboard-html.js";
import { serveLegalPage } from "./web-dashboard-legal.js";
import { serveDashboardBrandAsset } from "./web-dashboard-brand.js";
import { serveAgentScript } from "./web-dashboard-static.js";
import { createDashboardClientConfigs } from "./web-dashboard-client-config.js";
import { buildDashboardEnrollmentCommands } from "./dashboard-enrollment-commands.js";
import { DashboardAuthHandler } from "./web-dashboard-auth.js";

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
}

export class WebDashboardHandler {
  private readonly auth: DashboardAuthHandler;

  constructor(private readonly deps: WebDashboardDependencies) {
    this.auth = new DashboardAuthHandler(deps);
  }

  getPrincipalFromSession(req: IncomingMessage): RemotePrincipal | undefined {
    return this.auth.getPrincipalFromSession(req);
  }

  async handleSharedGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    return this.auth.handleSharedGoogleCallback(req, res);
  }

  /** Handle routes for web UI, authentication, dashboard APIs, and agent scripts. */
  async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (this.handleScriptRoutes(req, res, pathname)) return true;
    if (await this.auth.handleAuthRoutes(req, res, pathname)) return true;
    if (await this.handleDashboardApiRoutes(req, res, pathname)) return true;
    if (this.handleDashboardPageRoutes(req, res, pathname)) return true;

    return false;
  }

  private handleScriptRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (req.method === "GET" && serveDashboardBrandAsset(res, pathname)) {
      return true;
    }
    if (
      (pathname === "/privacy" || pathname === "/terms" || pathname === "/support") &&
      req.method === "GET"
    ) {
      serveLegalPage(res, pathname);
      return true;
    }
    if (pathname === "/.well-known/openai-apps-challenge" && req.method === "GET") {
      const challenge = process.env.SSH_MCP_OPENAI_DOMAIN_CHALLENGE?.trim();
      if (challenge && /^[A-Za-z0-9._-]{8,2048}$/u.test(challenge)) {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(challenge);
        return true;
      }
    }
    // 1. Static installation scripts
    if (
      (pathname === "/install-agent.sh" ||
        pathname === "/install/remote-linux.sh" ||
        pathname === "/install/remote-macos.sh") &&
      req.method === "GET"
    ) {
      serveAgentScript(res, "scripts/install-agent.sh", "text/x-shellscript; charset=utf-8", {
        publicBaseUrl: this.deps.config.publicBaseUrl,
      });
      return true;
    }
    if (
      (pathname === "/install-agent.ps1" || pathname === "/install/remote-windows.ps1") &&
      req.method === "GET"
    ) {
      serveAgentScript(res, "scripts/install-agent.ps1", "text/plain; charset=utf-8", {
        publicBaseUrl: this.deps.config.publicBaseUrl,
      });
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
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) {
      this.auth.assertBrowserMutation(req);
    }
    // 3. Web Dashboard REST APIs
    if (pathname === "/api/dashboard/me" && req.method === "GET") {
      this.auth.handleApiMe(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/usage" && req.method === "GET") {
      this.handleApiUsage(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/user-usage" && req.method === "GET") {
      this.handleApiUserUsage(req, res);
      return true;
    }
    if (pathname === "/api/dashboard/ai-clients" && req.method === "GET") {
      this.handleApiAiClients(req, res);
      return true;
    }
    if (
      pathname.startsWith("/api/dashboard/ai-clients/") &&
      pathname.endsWith("/revoke") &&
      req.method === "POST"
    ) {
      this.handleApiRevokeAiClient(req, res, pathname);
      return true;
    }
    if (pathname.startsWith("/api/dashboard/ai-connections/")) {
      if (req.method === "PUT" && pathname.endsWith("/devices")) {
        await this.handleApiSaveAiConnectionDevices(req, res, pathname);
        return true;
      }
      if (req.method === "POST" && pathname.endsWith("/disconnect")) {
        this.handleApiDisconnectAiConnection(req, res, pathname);
        return true;
      }
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

  private handleApiAiClients(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    jsonResponse(
      res,
      200,
      {
        clients: this.deps.store.listUserOAuthClients(principal.userId, new Date().toISOString()),
        connections: this.deps.store.listUserOAuthConnections(principal.userId),
        strictVisibility: this.deps.store.isStrictVisibilityEnabled(principal.userId),
      },
      addNoStore(),
    );
  }

  private handleApiRevokeAiClient(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const clientId = pathname.slice("/api/dashboard/ai-clients/".length, -"/revoke".length);
    // Registered IDs are server-generated and never contain a slash.
    if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(clientId)) {
      jsonResponse(res, 404, { error: "AI client not found" }, addNoStore());
      return;
    }
    const revoked = this.deps.store.revokeUserOAuthClientGrants(
      principal.userId,
      clientId,
      new Date().toISOString(),
    );
    if (revoked === undefined) {
      jsonResponse(res, 404, { error: "AI client not found" }, addNoStore());
      return;
    }
    if (revoked > 0) {
      this.deps.audit({
        userId: principal.userId,
        eventType: "oauth_client_grants_revoked",
        severity: "warn",
        metadata: { client_id: clientId, revoked_refresh_tokens: revoked },
      });
    }
    jsonResponse(res, 200, { revokedRefreshTokens: revoked }, addNoStore());
  }

  private async handleApiSaveAiConnectionDevices(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const connectionId = pathname.slice(
      "/api/dashboard/ai-connections/".length,
      -"/devices".length,
    );
    if (
      !/^con_[a-f0-9]{32}$/.test(connectionId) ||
      !this.deps.store.getOAuthConnection(principal.userId, connectionId)
    ) {
      jsonResponse(res, 404, { error: "AI connection not found" }, addNoStore());
      return;
    }
    const body = await readJson(req);
    if (
      !Array.isArray(body.deviceIds) ||
      body.deviceIds.length > 100 ||
      !body.deviceIds.every((id) => typeof id === "string")
    ) {
      throw safeError("FORBIDDEN", "Select at most 100 devices", 400);
    }
    try {
      this.deps.store.setOAuthConnectionDevices(
        principal.userId,
        connectionId,
        body.deviceIds,
        new Date().toISOString(),
      );
    } catch {
      throw safeError("FORBIDDEN", "Device selection is invalid or no longer available", 400);
    }
    this.deps.audit({
      userId: principal.userId,
      eventType: "ai_connection_devices_updated",
      severity: "warn",
      metadata: { connection_id: connectionId, device_count: body.deviceIds.length },
    });
    jsonResponse(
      res,
      200,
      {
        connectionId,
        deviceIds: this.deps.store.listGrantedDevices(principal.userId, connectionId),
      },
      addNoStore(),
    );
  }

  private handleApiDisconnectAiConnection(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const connectionId = pathname.slice(
      "/api/dashboard/ai-connections/".length,
      -"/disconnect".length,
    );
    if (
      !/^con_[a-f0-9]{32}$/.test(connectionId) ||
      !this.deps.store.getOAuthConnection(principal.userId, connectionId)
    ) {
      jsonResponse(res, 404, { error: "AI connection not found" }, addNoStore());
      return;
    }
    const revoked = this.deps.store.revokeOAuthConnection(
      principal.userId,
      connectionId,
      new Date().toISOString(),
    );
    if (revoked) {
      this.deps.audit({
        userId: principal.userId,
        eventType: "ai_connection_disconnected",
        severity: "warn",
        metadata: { connection_id: connectionId },
      });
    }
    jsonResponse(res, 200, { disconnected: true }, addNoStore());
  }

  private handleApiUsage(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    if (!this.auth.isUsageOwner(principal)) {
      jsonResponse(res, 403, { error: "Service owner access required" }, addNoStore());
      return;
    }
    jsonResponse(res, 200, this.deps.store.getServiceUsage(), addNoStore());
  }

  private handleApiUserUsage(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    jsonResponse(res, 200, this.deps.store.getUserUsage(principal.userId), addNoStore());
  }

  private handleApiDevices(req: IncomingMessage, res: ServerResponse): void {
    const principal = this.getPrincipalFromSession(req);
    if (!principal) {
      jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
      return;
    }
    const agents = this.deps.store.listAgents(principal.userId);
    const connections = this.deps.store.listUserOAuthConnections(principal.userId);
    const enriched = agents.map((agent) => {
      const sanitized = sanitizeAgent(agent);
      const isOnline = this.deps.agentHandler.isAgentOnline(agent.id);
      return {
        ...sanitized,
        isLiveConnected: isOnline,
        aiConnections: connections
          .filter(
            (connection) =>
              connection.status === "active" && connection.deviceIds.includes(agent.id),
          )
          .map((connection) => ({ id: connection.id, name: connection.clientName })),
        status: isOnline ? "online" : sanitized.status,
      };
    });
    jsonResponse(
      res,
      200,
      {
        devices: enriched,
        strictVisibility: this.deps.store.isStrictVisibilityEnabled(principal.userId),
      },
      addNoStore(),
    );
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
    const agent = this.deps.store.getAgent(agentId);
    if (agent?.userId !== principal.userId) {
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
    const aliases = new Map(
      this.deps.store.listAgents(principal.userId).map((agent) => [agent.id, agent.alias]),
    );
    const events = this.deps.store.listAudit(principal.userId, undefined, 50).map((event) => ({
      ...event,
      agentAlias: event.agentId ? aliases.get(event.agentId) : undefined,
    }));
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
            serviceOwner: this.auth.isUsageOwner(principal),
            userUsage: this.deps.store.getUserUsage(principal.userId),
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
      // The signed-in dashboard sends a one-time enrollment token only to
      // its local 127.0.0.1 listener on an ephemeral port. Restrict this
      // exception to loopback IPv4 (not arbitrary LAN/HTTP origins).
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(
      renderDashboardHtml(
        initialUserBase64,
        mcpUrlJson,
        publicUrlJson,
        JSON.stringify({
          github: Boolean(this.deps.config.githubClientId && this.deps.config.githubClientSecret),
          google: Boolean(this.deps.config.googleClientId && this.deps.config.googleClientSecret),
        }),
      ),
    );
  }
}
