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
  randomToken,
  signEnvelope,
  verifyRemoteAccessToken,
  type JwtKeyPair,
  type PemKeyPair,
} from "./crypto.js";
import { loadRemoteConfig } from "./config.js";
import {
  isRecord,
  asString,
  negotiateMcpProtocolVersion,
  quotePosixArg,
  quotePowerShellArg,
  addNoStore,
  safeError,
  isValidEd25519PublicKey,
  readJson,
  sanitizeAgent,
} from "./http-util.js";
import { listRemoteToolDescriptors } from "./mcp-tools.js";
import { createAgentPolicy, mergeCustomPolicy } from "./policy.js";
import { parseAgentHostMetadata } from "./schemas.js";
import { hasCapability } from "./scopes.js";
import { RemoteStore } from "./store.js";
import { OAuthHandler, type PendingAuthorize } from "./oauth-handler.js";
import {
  AgentWebSocketHandler,
  type AgentConnection,
  type PendingAction,
} from "./agent-handler.js";
import type {
  ActionRecord,
  ActionRequestEnvelope,
  ActionResultEnvelope,
  AuditEvent,
  RemoteAgentRecord,
  RemoteConfig,
  RemoteErrorCode,
  RemotePrincipal,
  RemoteToolName,
  PolicyUpdateEnvelope,
} from "./types.js";
import { TOOL_CAPABILITY_MAP } from "./types.js";
import { jsonResponse } from "./util.js";
import { SERVER_VERSION } from "../mcp.js";

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
    );
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
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
      jsonResponse(res, 200, this.oauth.protectedResourceMetadata(), addNoStore());
      return true;
    }
    if (pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      jsonResponse(res, 200, this.oauth.authorizationServerMetadata(), addNoStore());
      return true;
    }
    if (pathname === "/oauth/register" && req.method === "POST") {
      await this.oauth.handleRegister(req, res);
      return true;
    }
    if (pathname === "/oauth/authorize" && req.method === "GET") {
      await this.oauth.handleAuthorize(req, res);
      return true;
    }
    if (pathname === "/oauth/callback/github" && req.method === "GET") {
      await this.oauth.handleGitHubCallback(req, res);
      return true;
    }
    if (pathname === "/oauth/token" && req.method === "POST") {
      await this.oauth.handleToken(req, res);
      return true;
    }
    if (pathname === "/oauth/jwks.json" && req.method === "GET") {
      await this.oauth.handleJwks(res);
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
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      this.sendUnauthorized(res);
      return;
    }
    let principal: RemotePrincipal;
    try {
      principal = await this.authenticate(req);
    } catch {
      this.sendUnauthorized(res);
      return;
    }
    const body = await readJson(req);
    const method = asString(body.method) ?? "";
    const rpcId = body.id ?? null;
    if (method === "initialize") {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          protocolVersion: negotiateMcpProtocolVersion(body.params),
          capabilities: { tools: {} },
          serverInfo: { name: "sshautomator-remote-agent", version: SERVER_VERSION },
        },
      });
      return;
    }
    if (method === "tools/list") {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: { tools: listRemoteToolDescriptors(principal.capabilities) },
      });
      return;
    }
    if (method === "tools/call") {
      const params = isRecord(body.params) ? body.params : {};
      const name = asString(params.name) as RemoteToolName | undefined;
      const args = isRecord(params.arguments) ? params.arguments : {};
      if (!name || !(name in TOOL_CAPABILITY_MAP)) {
        jsonResponse(res, 200, {
          jsonrpc: "2.0",
          id: rpcId,
          error: { code: -32602, message: "Unknown tool" },
        });
        return;
      }
      let callResult: unknown;
      try {
        callResult = await this.callRemoteTool(principal, name, args);
      } catch (error) {
        const isStructured = error !== null && typeof error === "object" && "message" in error;
        const message = isStructured
          ? String((error as { message: string }).message)
          : "Tool call failed";
        const errorCode =
          isStructured && "code" in error
            ? String((error as { code: string }).code)
            : "TOOL_CALL_FAILED";
        jsonResponse(res, 200, {
          jsonrpc: "2.0",
          id: rpcId,
          error: { code: -32000, message, data: { code: errorCode } },
        });
        return;
      }
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          content: [{ type: "text", text: JSON.stringify(callResult, null, 2) }],
          structuredContent: callResult,
        },
      });
      return;
    }
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id: rpcId,
      error: { code: -32601, message: "Method not found" },
    });
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
      const result = this.createEnrollmentToken(principal, body);
      jsonResponse(res, 201, result, addNoStore());
      return;
    }
    if (pathname === "/api/agents" && req.method === "GET") {
      jsonResponse(res, 200, {
        agents: this.store.listAgents(principal.userId).map(sanitizeAgent),
      });
      return;
    }
    const agentMatch = /^\/api\/agents\/([^/]+)(?:\/(policy|revoke))?$/u.exec(pathname);
    if (agentMatch) {
      const agent = this.resolveAgent(principal.userId, agentMatch[1] ?? "");
      if (!agent) {
        throw safeError("AGENT_NOT_FOUND", "Agent not found", 404);
      }
      if (!agentMatch[2] && req.method === "GET") {
        jsonResponse(res, 200, { agent: sanitizeAgent(agent) });
        return;
      }
      if ((!agentMatch[2] || agentMatch[2] === "policy") && req.method === "PATCH") {
        const body = await readJson(req);
        jsonResponse(res, 200, {
          agent: sanitizeAgent(this.updateAgentPolicy(principal, agent, body.policy)),
        });
        return;
      }
      if (agentMatch[2] === "revoke" && req.method === "POST") {
        jsonResponse(res, 200, { agent: sanitizeAgent(this.revokeAgent(principal, agent)) });
        return;
      }
    }
    if (pathname === "/api/audit" && req.method === "GET") {
      const url = new URL(req.url ?? "/api/audit", this.config.publicBaseUrl);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      jsonResponse(res, 200, { events: this.store.listAudit(principal.userId, undefined, limit) });
      return;
    }
    jsonResponse(res, 404, { error: "Not found" });
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
      return await verifyRemoteAccessToken(
        req.headers.authorization,
        this.config,
        this.requireJwtKeyPair(),
      );
    } catch {
      this.audit({
        eventType: "token_validation_failure",
        severity: "warn",
        metadata: {},
      });
      throw safeError("UNAUTHORIZED", "Missing or invalid bearer token", 401);
    }
  }

  private sendUnauthorized(res: ServerResponse): void {
    jsonResponse(
      res,
      401,
      { error: "Missing or invalid bearer token" },
      {
        "WWW-Authenticate": `Bearer resource_metadata="${this.config.publicBaseUrl}/.well-known/oauth-protected-resource"`,
      },
    );
  }

  private async callRemoteTool(
    principal: RemotePrincipal,
    tool: RemoteToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const capability = TOOL_CAPABILITY_MAP[tool];
    if (!hasCapability(principal.capabilities, capability)) {
      throw safeError("INVALID_SCOPE", `Scope does not grant ${capability}`, 403);
    }

    if (tool === "list_hosts") {
      return {
        hosts: this.store.listAgents(principal.userId).map((agent) => ({
          id: agent.id,
          alias: agent.alias,
          status: agent.status,
          host: agent.hostMetadata,
        })),
      };
    }
    if (tool === "list_agents") {
      return { agents: this.store.listAgents(principal.userId).map(sanitizeAgent) };
    }
    if (tool === "create_enrollment_token") {
      return this.createEnrollmentToken(principal, args);
    }
    if (tool === "get_agent_install_command") {
      const agent = this.requireAgent(principal.userId, args);
      return this.installCommand(agent, undefined);
    }
    if (tool === "update_agent_policy") {
      const agent = this.requireAgent(principal.userId, args);
      return { agent: sanitizeAgent(this.updateAgentPolicy(principal, agent, args.policy)) };
    }
    if (tool === "revoke_agent") {
      const agent = this.requireAgent(principal.userId, args);
      return { agent: sanitizeAgent(this.revokeAgent(principal, agent)) };
    }
    if (tool === "get_audit_events") {
      const agentId = asString(args.agent_id_or_alias)
        ? this.resolveAgent(principal.userId, String(args.agent_id_or_alias))?.id
        : undefined;
      return { events: this.store.listAudit(principal.userId, agentId, Number(args.limit ?? 50)) };
    }

    const agent = this.requireAgent(principal.userId, args);
    if (!agent.policy.capabilities[capability]) {
      this.audit({
        userId: principal.userId,
        agentId: agent.id,
        eventType: "action_denied",
        severity: "warn",
        metadata: { tool, capability, reason: "capability disabled by agent policy" },
      });
      throw safeError("CAPABILITY_DENIED", `Agent policy does not allow ${capability}`, 403);
    }
    const actionResult = await this.dispatchAction(principal, agent, tool, capability, args);
    return { action: actionResult };
  }

  private createEnrollmentToken(
    principal: RemotePrincipal,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const alias = asString(args.alias)?.trim();
    if (!alias) {
      throw safeError("FORBIDDEN", "alias is required");
    }
    const profile = asString(args.requested_profile) ?? "read-only";
    const policy = createAgentPolicy(
      profile === "operations" || profile === "full-admin" ? profile : "read-only",
    );
    const now = nowIso();
    const existing = this.store.getAgentByAlias(principal.userId, alias);
    if (existing && existing.status !== "revoked") {
      throw safeError("FORBIDDEN", "Agent alias already exists");
    }
    const agent: RemoteAgentRecord = {
      id: id("agt"),
      userId: principal.userId,
      alias,
      status: "pending",
      profile: policy.profile,
      policy,
      policyVersion: policy.version,
      createdAt: now,
      updatedAt: now,
    };
    const token = randomToken(32);
    this.store.insertAgent(agent);
    this.store.insertEnrollmentToken({
      id: id("enr"),
      agentId: agent.id,
      userId: principal.userId,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + this.config.enrollmentTokenTtlSeconds * 1000).toISOString(),
      createdAt: now,
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "enrollment_token_created",
      severity: "info",
      metadata: { alias, profile: policy.profile },
    });
    return { ...this.installCommand(agent, token), enrollment_token: token };
  }

  private installCommand(
    agent: RemoteAgentRecord,
    token: string | undefined,
  ): Record<string, unknown> {
    const tokenArgument = token ?? "<create-a-new-enrollment-token>";
    const posixBase = [
      "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll",
      `--server ${quotePosixArg(this.config.publicBaseUrl)}`,
      `--token ${quotePosixArg(tokenArgument)}`,
      `--alias ${quotePosixArg(agent.alias)}`,
    ].join(" ");
    const powershellBase = [
      "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll",
      `--server ${quotePowerShellArg(this.config.publicBaseUrl)}`,
      `--token ${quotePowerShellArg(tokenArgument)}`,
      `--alias ${quotePowerShellArg(agent.alias)}`,
    ].join(" ");
    return {
      agent_id: agent.id,
      alias: agent.alias,
      token_recoverable: Boolean(token),
      commands: {
        npm: posixBase,
        run: "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run",
        windows: powershellBase,
      },
      expires_in_seconds: token ? this.config.enrollmentTokenTtlSeconds : undefined,
    };
  }

  private updateAgentPolicy(
    principal: RemotePrincipal,
    agent: RemoteAgentRecord,
    value: unknown,
  ): RemoteAgentRecord {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const nextVersion = agent.policyVersion + 1;
    const merged = mergeCustomPolicy(isRecord(value) ? value : {});
    const policy = {
      ...merged,
      maxActionTimeoutSeconds: Math.min(
        merged.maxActionTimeoutSeconds,
        this.config.maxActionTimeoutSeconds,
      ),
      maxOutputBytes: Math.min(merged.maxOutputBytes, this.config.maxOutputBytes),
      version: nextVersion,
    };
    const updated = {
      ...agent,
      profile: policy.profile,
      policy,
      policyVersion: nextVersion,
      updatedAt: nowIso(),
    };
    this.store.updateAgent(updated);
    const live = this.agentConnections.get(agent.id);
    if (live) {
      const envelope: PolicyUpdateEnvelope = {
        type: "policy.update",
        agent_id: agent.id,
        policy,
        policy_version: nextVersion,
        issued_at: nowIso(),
        nonce: randomToken(16),
        signature: "",
      };
      envelope.signature = signEnvelope(
        envelope as unknown as Record<string, unknown>,
        this.controlPlaneKeyPair.privateKeyPem,
      );
      live.connection.sendJson(envelope);
    }
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "policy_updated",
      severity: "warn",
      metadata: { profile: updated.profile, policy_version: updated.policyVersion },
    });
    return updated;
  }

  private revokeAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): RemoteAgentRecord {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const updated = { ...agent, status: "revoked" as const, updatedAt: nowIso() };
    this.store.updateAgent(updated);
    this.agentConnections.get(agent.id)?.connection.close();
    this.agentConnections.delete(agent.id);
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "agent_revoked",
      severity: "warn",
      metadata: {},
    });
    return updated;
  }

  private async dispatchAction(
    principal: RemotePrincipal,
    agent: RemoteAgentRecord,
    tool: RemoteToolName,
    capability: ActionRecord["capability"],
    args: Record<string, unknown>,
  ): Promise<ActionResultEnvelope> {
    if (agent.status === "revoked") {
      throw safeError("AGENT_REVOKED", "Agent is revoked", 410);
    }
    const live = this.agentConnections.get(agent.id);
    if (!live) {
      throw safeError("AGENT_OFFLINE", "Agent is offline", 503);
    }
    const actionId = id("act");
    const timeoutSeconds = Math.min(
      Number(args.timeout_seconds ?? agent.policy.maxActionTimeoutSeconds),
      agent.policy.maxActionTimeoutSeconds,
      this.config.maxActionTimeoutSeconds,
    );
    const issuedAt = nowIso();
    const deadline = new Date(Date.now() + timeoutSeconds * 1000).toISOString();
    const envelope: ActionRequestEnvelope = {
      type: "action.request",
      action_id: actionId,
      agent_id: agent.id,
      user_id: principal.userId,
      tool,
      capability,
      args,
      policy_version: agent.policyVersion,
      issued_at: issuedAt,
      deadline,
      nonce: randomToken(16),
      signature: "",
    };
    envelope.signature = signEnvelope(
      envelope as unknown as Record<string, unknown>,
      this.controlPlaneKeyPair.privateKeyPem,
    );
    const action: ActionRecord = {
      id: actionId,
      userId: principal.userId,
      agentId: agent.id,
      tool,
      capability,
      args,
      status: "sent",
      issuedAt,
      deadline,
    };
    this.store.insertAction(action);
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      actionId,
      eventType: "action_requested",
      severity: "info",
      metadata: { tool, capability },
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      actionId,
      eventType: "action_allowed",
      severity: "info",
      metadata: { tool, capability },
    });
    let result: ActionResultEnvelope;
    try {
      result = await new Promise<ActionResultEnvelope>((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            this.pendingActions.delete(actionId);
            reject(Object.assign(new Error("Agent timed out"), { code: "AGENT_TIMEOUT" }));
          },
          timeoutSeconds * 1000 + 2000,
        );
        this.pendingActions.set(actionId, { action, resolve, reject, timeout });
        live.connection.sendJson(envelope);
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: RemoteErrorCode }).code
          : "INTERNAL_ERROR";
      this.store.updateAction({
        ...action,
        status: code === "AGENT_TIMEOUT" ? "timeout" : "error",
        completedAt: nowIso(),
        errorCode: code,
      });
      this.audit({
        userId: principal.userId,
        agentId: agent.id,
        actionId,
        eventType: "action_denied_or_failed",
        severity: "warn",
        metadata: { status: "error", error_code: code },
      });
      throw safeError(
        code,
        code === "AGENT_TIMEOUT" ? "Agent timed out" : "Agent action failed",
        504,
      );
    }
    this.store.updateAction({
      ...action,
      status: result.status === "ok" ? "completed" : "error",
      completedAt: nowIso(),
      result,
      errorCode: result.error_code,
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      actionId,
      eventType: result.status === "ok" ? "action_completed" : "action_denied_or_failed",
      severity: result.status === "ok" ? "info" : "warn",
      metadata: { status: result.status, error_code: result.error_code },
    });
    return result;
  }

  private requireAgent(userId: string, args: Record<string, unknown>): RemoteAgentRecord {
    const agent = this.resolveAgent(userId, asString(args.agent_id_or_alias) ?? "");
    if (!agent) {
      throw safeError("AGENT_NOT_FOUND", "Agent not found", 404);
    }
    return agent;
  }

  private resolveAgent(userId: string, value: string): RemoteAgentRecord | undefined {
    if (!value) {
      return undefined;
    }
    const byId = this.store.getAgent(value);
    if (byId?.userId === userId) {
      return byId;
    }
    return this.store.getAgentByAlias(userId, value);
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
