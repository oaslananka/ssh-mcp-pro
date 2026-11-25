import { RemoteAgentOperations } from "./control-plane-agent-operations.js";
import { RemoteMcpRequestHandler } from "./control-plane-mcp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import {
  ensurePemKeyPair,
  hashSecret,
  id,
  keyId,
  loadJwtKeyPair,
  nowIso,
  verifyRemoteAccessToken,
  type JwtKeyPair,
  type PemKeyPair,
} from "./crypto.js";
import { loadRemoteConfig } from "./config.js";
import {
  isRecord,
  asString,
  addNoStore,
  safeError,
  isValidEd25519PublicKey,
  readJson,
  sanitizeAgent,
} from "./http-util.js";
import { parseAgentHostMetadata } from "./schemas.js";
import { hasCapability } from "./scopes.js";
import { RemoteStore } from "./store.js";
import { OAuthHandler, type PendingAuthorize } from "./oauth-handler.js";
import { WebDashboardHandler } from "./web-dashboard.js";
import { AgentEnrollmentService } from "./agent-enrollment.js";
import {
  AgentWebSocketHandler,
  type AgentConnection,
  type PendingAction,
} from "./agent-handler.js";
import type {
  AuditEvent,
  RemoteAgentRecord,
  RemoteConfig,
  RemotePrincipal,
  RemoteToolName,
} from "./types.js";
import { jsonResponse } from "./util.js";

export { REMOTE_MCP_SERVER_NAME } from "./control-plane-mcp.js";

export class RemoteControlPlane {
  readonly config: RemoteConfig;
  readonly store: RemoteStore;
  private readonly authorizeTransactions = new Map<string, PendingAuthorize>();
  private readonly agentConnections = new Map<string, AgentConnection>();
  private readonly agentHelloNonces = new Map<string, Map<string, number>>();
  private readonly pendingActions = new Map<string, PendingAction>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private jwtKeyPair: JwtKeyPair | undefined;
  private readonly controlPlaneKeyPair: PemKeyPair;
  readonly oauth: OAuthHandler;
  readonly agentHandler: AgentWebSocketHandler;
  readonly dashboard: WebDashboardHandler;
  private readonly enrollment: AgentEnrollmentService;
  private readonly agentOperations: RemoteAgentOperations;
  private readonly mcpHandler: RemoteMcpRequestHandler;

  constructor(config = loadRemoteConfig()) {
    this.config = config;
    this.store = new RemoteStore(config.databaseUrl);
    this.controlPlaneKeyPair = ensurePemKeyPair(config.controlPlaneSigningKeyPath);
    this.oauth = new OAuthHandler(
      config,
      this.store,
      this.authorizeTransactions,
      () => this.requireJwtKeyPair(),
      (event) => this.audit(event),
    );
    this.agentHandler = new AgentWebSocketHandler(
      config,
      this.store,
      this.agentConnections,
      this.agentHelloNonces,
      this.pendingActions,
      (event) => this.audit(event),
      this.controlPlaneKeyPair.privateKeyPem,
    );
    this.enrollment = new AgentEnrollmentService(this.config, this.store, (event) =>
      this.audit(event),
    );
    this.agentOperations = new RemoteAgentOperations(
      config,
      this.store,
      this.oauth,
      this.enrollment,
      this.agentHandler,
      this.agentConnections,
      this.pendingActions,
      this.controlPlaneKeyPair,
      (event) => this.audit(event),
    );
    this.mcpHandler = new RemoteMcpRequestHandler(
      config,
      (req) => this.authenticate(req),
      (principal, tool, args) => this.callRemoteTool(principal, tool, args),
    );
    this.dashboard = new WebDashboardHandler({
      config: this.config,
      store: this.store,
      oauth: this.oauth,
      agentHandler: this.agentHandler,
      getJwtKeyPair: () => this.requireJwtKeyPair(),
      audit: (event) => this.audit(event),
      createEnrollmentToken: (principal, args) =>
        this.enrollment.createEnrollmentToken(principal, args),
      updateAgentPolicy: (principal, agent, policy) =>
        this.updateAgentPolicy(principal, agent, policy),
      revokeAgent: (principal, agent) => this.revokeAgent(principal, agent),
    });
    this.cleanupInterval = setInterval(() => this.cleanupEphemeralState(), 60_000);
    this.cleanupInterval.unref?.();
  }

  async initialize(): Promise<void> {
    this.jwtKeyPair = await loadJwtKeyPair(this.config.jwtSigningKeyPath);
  }

  close(): void {
    clearInterval(this.cleanupInterval);
    this.agentHandler.close();
    for (const pending of this.pendingActions.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Control plane shutting down"));
    }
    this.pendingActions.clear();
    for (const entry of this.agentConnections.values()) {
      entry.connection.close();
    }
    this.agentConnections.clear();
    this.agentHelloNonces.clear();
    this.authorizeTransactions.clear();
    this.store.close();
  }

  private cleanupEphemeralState(now = Date.now()): void {
    this.oauth.cleanupExpired(now);
    this.agentHandler.cleanupEphemeralState(now);
    try {
      // Reuse the existing minute timer, avoiding another background worker.
      this.store.pruneExpiredTransientRecords(new Date(now).toISOString());
    } catch {
      // A storage maintenance failure must not terminate the live MCP server.
      // The following cleanup tick retries without logging sensitive data.
      console.error("Remote transient credential cleanup failed; will retry");
    }
  }

  private async handleGoogleOAuthCallback(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Both OAuth flows use the registered Google URI, but isolated state/cookies.
    if (await this.dashboard.handleSharedGoogleCallback(req, res)) return;
    await this.oauth.handleGoogleCallback(req, res);
  }

  private async handleOAuthRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // Route lookup makes allowed HTTP methods explicit without nesting authorization logic.
    const routes: Record<string, { methods: readonly string[]; handle: () => Promise<void> }> = {
      "/oauth/reviewer/login": {
        methods: ["GET", "POST"],
        handle: () => this.oauth.handleReviewerLogin(req, res),
      },
      "/oauth/reviewer/logout": {
        methods: ["POST"],
        handle: () => this.oauth.handleReviewerLogout(req, res),
      },
      "/oauth/register": { methods: ["POST"], handle: () => this.oauth.handleRegister(req, res) },
      "/oauth/authorize": { methods: ["GET"], handle: () => this.oauth.handleAuthorize(req, res) },
      "/oauth/approve": { methods: ["POST"], handle: () => this.oauth.handleApprove(req, res) },
      "/oauth/callback/github": {
        methods: ["GET"],
        handle: () => this.oauth.handleGitHubCallback(req, res),
      },
      "/oauth/callback/google": {
        methods: ["GET"],
        handle: () => this.handleGoogleOAuthCallback(req, res),
      },
      "/oauth/token": { methods: ["POST"], handle: () => this.oauth.handleToken(req, res) },
      "/oauth/revoke": { methods: ["POST"], handle: () => this.oauth.handleRevoke(req, res) },
      "/oauth/jwks.json": { methods: ["GET"], handle: () => this.oauth.handleJwks(res) },
    };
    const route = routes[pathname];
    if (!route?.methods.includes(req.method ?? "")) return false;
    await route.handle();
    return true;
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    // Browsers only honor HSTS on authenticated HTTPS responses. Do not
    // impose HTTPS on intentionally HTTP-only localhost development servers.
    if (new URL(this.config.publicBaseUrl).protocol === "https:") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    if (pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
      jsonResponse(res, 200, this.oauth.protectedResourceMetadata(), addNoStore());
      return true;
    }
    if (pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      jsonResponse(res, 200, this.oauth.authorizationServerMetadata(), addNoStore());
      return true;
    }
    if (await this.handleOAuthRequest(req, res, pathname)) {
      return true;
    }
    if (pathname === "/readyz" && req.method === "GET") {
      jsonResponse(res, 200, {
        ok: true,
        service: "ssh-mcp-pro",
        control_plane: true,
        agents_online: this.agentHandler.connectedAgentCount,
        agent_connections_open: this.agentHandler.openConnectionCount,
        agent_connections_unauthenticated: this.agentHandler.unauthenticatedConnectionCount,
      });
      return true;
    }
    if (pathname === "/mcp") {
      const passthrough = ["1", "true", "yes", "on"].includes(
        (process.env.SSH_MCP_REMOTE_AGENT_MCP_PASSTHROUGH ?? "").toLowerCase(),
      );
      if (passthrough) {
        return false;
      }
      await this.handleMcp(req, res);
      return true;
    }
    if (pathname.startsWith("/api/agents") || pathname === "/api/audit") {
      await this.handleApi(req, res, pathname);
      return true;
    }
    if (await this.dashboard.handleHttpRequest(req, res, pathname)) {
      return true;
    }
    return false;
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer<ArrayBufferLike>,
    pathname: string,
  ): boolean {
    return this.agentHandler.handleUpgrade(req, socket, head, pathname);
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.mcpHandler.handleMcp(req, res);
  }

  private async handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (pathname === "/api/agents/enroll" && req.method === "POST") {
      await this.handleAgentEnroll(req, res);
      return;
    }

    const principal = await this.authenticate(req);
    if (pathname === "/api/agents/enrollment-tokens" && req.method === "POST") {
      const body = await readJson(req);
      const result = this.enrollment.createEnrollmentToken(principal, body);
      jsonResponse(res, 201, result, addNoStore());
      return;
    }
    if (pathname === "/api/agents" && req.method === "GET") {
      if (!hasCapability(principal.capabilities, "agents.read")) {
        throw safeError("INVALID_SCOPE", "agents:read scope is required", 403);
      }
      jsonResponse(res, 200, {
        agents: this.visibleAgents(principal).map(sanitizeAgent),
      });
      return;
    }
    if (await this.handleAgentApiRoute(req, res, pathname, principal)) {
      return;
    }
    if (pathname === "/api/audit" && req.method === "GET") {
      if (!hasCapability(principal.capabilities, "agents.admin")) {
        throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
      }
      const url = new URL(req.url ?? "/api/audit", this.config.publicBaseUrl);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const allowed = new Set(this.visibleAgents(principal).map((agent) => agent.id));
      jsonResponse(res, 200, {
        events: this.store
          .listAudit(principal.userId, undefined, limit)
          .filter((event) => !!event.agentId && allowed.has(event.agentId)),
      });
      return;
    }
    jsonResponse(res, 404, { error: "Not found" });
  }

  private async handleAgentApiRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    principal: RemotePrincipal,
  ): Promise<boolean> {
    const agentMatch = /^\/api\/agents\/([^/]+)(?:\/(policy|revoke))?$/u.exec(pathname);
    if (agentMatch) {
      const agent = this.resolveAgent(principal.userId, agentMatch[1] ?? "");
      if (!agent) {
        throw safeError("AGENT_NOT_FOUND", "Agent not found", 404);
      }
      this.requireVisibleAgent(principal, agent);
      if (!agentMatch[2] && req.method === "GET") {
        if (!hasCapability(principal.capabilities, "agents.read")) {
          throw safeError("INVALID_SCOPE", "agents:read scope is required", 403);
        }
        jsonResponse(res, 200, { agent: sanitizeAgent(agent) });
        return true;
      }
      if ((!agentMatch[2] || agentMatch[2] === "policy") && req.method === "PATCH") {
        const body = await readJson(req);
        jsonResponse(res, 200, {
          agent: sanitizeAgent(this.updateAgentPolicy(principal, agent, body.policy)),
        });
        return true;
      }
      if (agentMatch[2] === "revoke" && req.method === "POST") {
        jsonResponse(res, 200, { agent: sanitizeAgent(this.revokeAgent(principal, agent)) });
        return true;
      }
    }
    return false;
  }

  private async handleAgentEnroll(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const token = asString(body.token) ?? "";
    const publicKey = asString(body.public_key) ?? "";
    const host = isRecord(body.host) ? parseAgentHostMetadata(body.host) : undefined;
    if (!token || !publicKey || !host) {
      throw safeError("FORBIDDEN", "token, public_key, and host are required");
    }
    if (!isValidEd25519PublicKey(publicKey)) {
      throw safeError("FORBIDDEN", "public_key must be an Ed25519 SPKI PEM public key");
    }
    const enrollment = this.store.getEnrollmentTokenByHash(hashSecret(token));
    if (!enrollment || enrollment.usedAt || new Date(enrollment.expiresAt).getTime() < Date.now()) {
      throw safeError("INVALID_TOKEN", "Enrollment token is expired or invalid", 401);
    }
    const agent = this.store.getAgent(enrollment.agentId);
    if (!agent || agent.status === "revoked") {
      throw safeError("AGENT_NOT_FOUND", "Pending agent not found", 404);
    }
    const now = nowIso();
    try {
      this.store.markEnrollmentTokenUsed(enrollment.tokenHash, now);
    } catch {
      throw safeError("INVALID_TOKEN", "Enrollment token is expired or invalid", 401);
    }
    const updated: RemoteAgentRecord = {
      ...agent,
      status: "offline",
      publicKey,
      hostMetadata: host,
      updatedAt: now,
    };
    this.store.updateAgent(updated);
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_enrolled",
      severity: "info",
      metadata: { alias: agent.alias, host: host.hostname },
    });
    jsonResponse(
      res,
      200,
      {
        agent_id: agent.id,
        alias: agent.alias,
        policy: agent.policy,
        websocket_url: `${this.config.publicBaseUrl.replace(/^http/u, "ws")}${this.config.agentWsPath}`,
        control_plane_public_key: this.controlPlaneKeyPair.publicKeyPem,
      },
      addNoStore(),
    );
  }

  private async authenticate(req: IncomingMessage): Promise<RemotePrincipal> {
    try {
      const principal = await verifyRemoteAccessToken(
        req.headers.authorization,
        this.config,
        this.requireJwtKeyPair(),
      );
      if (principal.provider === "demo" && !this.oauth.isReviewerEnabled()) {
        throw safeError("UNAUTHORIZED", "Missing or invalid bearer token", 401);
      }
      if (principal.provider !== "demo") {
        const connection = principal.connectionId
          ? this.store.getOAuthConnection(principal.userId, principal.connectionId)
          : undefined;
        if (
          principal.connectionId
            ? !connection ||
              connection.clientId !== principal.clientId ||
              connection.status !== "active"
            : this.store.isStrictVisibilityEnabled(principal.userId)
        ) {
          throw safeError("UNAUTHORIZED", "AI connection is not authorized", 401);
        }
      }
      return principal;
    } catch {
      this.audit({
        eventType: "token_validation_failure",
        severity: "warn",
        metadata: {},
      });
      throw safeError("UNAUTHORIZED", "Missing or invalid bearer token", 401);
    }
  }

  private visibleAgents(principal: RemotePrincipal): RemoteAgentRecord[] {
    return this.agentOperations.visibleAgents(principal);
  }

  private requireVisibleAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): void {
    this.agentOperations.requireVisibleAgent(principal, agent);
  }

  private async callRemoteTool(
    principal: RemotePrincipal,
    tool: RemoteToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.agentOperations.callRemoteTool(principal, tool, args);
  }

  private updateAgentPolicy(
    principal: RemotePrincipal,
    agent: RemoteAgentRecord,
    value: unknown,
  ): RemoteAgentRecord {
    return this.agentOperations.updateAgentPolicy(principal, agent, value);
  }

  private revokeAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): RemoteAgentRecord {
    return this.agentOperations.revokeAgent(principal, agent);
  }

  private resolveAgent(userId: string, value: string): RemoteAgentRecord | undefined {
    return this.agentOperations.resolveAgent(userId, value);
  }

  private audit(input: Omit<AuditEvent, "id" | "createdAt">): void {
    this.store.insertAudit({
      id: id("aud"),
      createdAt: nowIso(),
      ...input,
      metadata: input.metadata,
    });
  }

  private requireJwtKeyPair(): JwtKeyPair {
    if (!this.jwtKeyPair) {
      throw new Error("Remote control plane was not initialized");
    }
    return this.jwtKeyPair;
  }
}

export async function createRemoteControlPlane(): Promise<RemoteControlPlane> {
  const controlPlane = new RemoteControlPlane();
  await controlPlane.initialize();
  return controlPlane;
}

export function controlPlanePublicKeyId(controlPlaneKeyPair: PemKeyPair): string {
  return keyId(controlPlaneKeyPair.publicKeyPem);
}
