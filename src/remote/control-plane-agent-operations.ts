import { id, nowIso, randomToken, signEnvelope, type PemKeyPair } from "./crypto.js";
import { asString, isRecord, safeError, sanitizeAgent } from "./http-util.js";
import { REVIEWER_DEMO_TOOL_NAMES } from "./mcp-tools.js";
import { reviewerDemoToolResult } from "./reviewer-demo-fixtures.js";
import { mergeCustomPolicy } from "./policy.js";
import { safeStoredActionArgs } from "./action-record-sanitize.js";
import { hasCapability } from "./scopes.js";
import type { RemoteStore } from "./store.js";
import type { OAuthHandler } from "./oauth-handler.js";
import type { AgentEnrollmentService } from "./agent-enrollment.js";
import type { AgentWebSocketHandler, AgentConnection, PendingAction } from "./agent-handler.js";
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
} from "./types.js";
import { REVIEWER_DEMO_USER_ID, TOOL_CAPABILITY_MAP } from "./types.js";

export class RemoteAgentOperations {
  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
    private readonly oauth: OAuthHandler,
    private readonly enrollment: AgentEnrollmentService,
    private readonly agentHandler: AgentWebSocketHandler,
    private readonly agentConnections: Map<string, AgentConnection>,
    private readonly pendingActions: Map<string, PendingAction>,
    private readonly controlPlaneKeyPair: PemKeyPair,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {}

  private callReviewerTool(
    principal: RemotePrincipal,
    tool: RemoteToolName,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      !this.oauth.isReviewerEnabled() ||
      principal.provider !== "demo" ||
      principal.userId !== REVIEWER_DEMO_USER_ID ||
      !REVIEWER_DEMO_TOOL_NAMES.has(tool)
    ) {
      throw safeError(
        "INVALID_SCOPE",
        "Reviewer sandbox only supports synthetic read-only tools",
        403,
      );
    }
    const capability = TOOL_CAPABILITY_MAP[tool];
    if (!hasCapability(principal.capabilities, capability)) {
      throw safeError("INVALID_SCOPE", `Scope does not grant ${capability}`, 403);
    }
    return reviewerDemoToolResult(tool, args);
  }

  private mayAccessAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): boolean {
    if (agent.userId !== principal.userId) return false;
    if (principal.connectionId) {
      const connection = this.store.getOAuthConnection(principal.userId, principal.connectionId);
      return (
        connection?.status === "active" &&
        connection.clientId === principal.clientId &&
        this.store.isDeviceGranted(principal.userId, principal.connectionId, agent.id)
      );
    }
    return !this.store.isStrictVisibilityEnabled(principal.userId);
  }

  visibleAgents(principal: RemotePrincipal): RemoteAgentRecord[] {
    return this.store
      .listAgents(principal.userId)
      .filter((agent) => this.mayAccessAgent(principal, agent));
  }

  requireVisibleAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): void {
    if (!this.mayAccessAgent(principal, agent)) {
      this.audit({
        userId: principal.userId,
        agentId: agent.id,
        eventType: "device_access_denied",
        severity: "warn",
        metadata: { connection_id: principal.connectionId ?? "legacy" },
      });
      throw safeError("AGENT_NOT_FOUND", "Device not available to this AI connection", 404);
    }
  }

  async callRemoteTool(
    principal: RemotePrincipal,
    tool: RemoteToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (principal.provider === "demo" || principal.userId === REVIEWER_DEMO_USER_ID) {
      return this.callReviewerTool(principal, tool, args);
    }

    const capability = TOOL_CAPABILITY_MAP[tool];
    if (!hasCapability(principal.capabilities, capability)) {
      throw safeError("INVALID_SCOPE", `Scope does not grant ${capability}`, 403);
    }
    // Copying reads an existing file before writing the destination. Both permissions
    // must belong to the OAuth client; agent-side policy checks alone are insufficient.
    if (
      tool === "file_manage" &&
      args.operation === "copy" &&
      !hasCapability(principal.capabilities, "files.read")
    ) {
      throw safeError("INVALID_SCOPE", "Copy requires files.read and files.write", 403);
    }

    if (tool === "list_hosts") {
      return {
        hosts: this.visibleAgents(principal).map((agent) => ({
          id: agent.id,
          alias: agent.alias,
          status: agent.status,
          host: agent.hostMetadata,
        })),
      };
    }
    if (tool === "list_agents") {
      return { agents: this.visibleAgents(principal).map(sanitizeAgent) };
    }
    if (tool === "create_enrollment_token") {
      return this.enrollment.createEnrollmentToken(principal, args);
    }
    if (tool === "get_agent_install_command") {
      const agent = this.requireAgent(principal, args);
      return this.enrollment.installCommand(agent, undefined);
    }
    if (tool === "update_agent_policy") {
      const agent = this.requireAgent(principal, args);
      return { agent: sanitizeAgent(this.updateAgentPolicy(principal, agent, args.policy)) };
    }
    if (tool === "revoke_agent") {
      const agent = this.requireAgent(principal, args);
      return { agent: sanitizeAgent(this.revokeAgent(principal, agent)) };
    }
    if (tool === "get_audit_events") {
      const agentId = asString(args.agent_id_or_alias)
        ? this.requireAgent(principal, args).id
        : undefined;
      const allowed = new Set(this.visibleAgents(principal).map((agent) => agent.id));
      return {
        events: this.store
          .listAudit(principal.userId, agentId, Number(args.limit ?? 50))
          .filter((event) => !!event.agentId && allowed.has(event.agentId)),
      };
    }

    const agent = this.requireAgent(principal, args);
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

  updateAgentPolicy(
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
      this.agentHandler.sendPolicyUpdate(updated, live.connection);
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

  revokeAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): RemoteAgentRecord {
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
      args: safeStoredActionArgs(tool, args),
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
        this.pendingActions.set(actionId, {
          action,
          connection: live.connection,
          resolve,
          reject,
          timeout,
        });
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
      if (code === "ACTION_OUTCOME_UNKNOWN") {
        throw safeError(
          code,
          "Agent connection lost after dispatch; action outcome is unknown. Inspect current state before retrying; do not automatically replay the action.",
          409,
        );
      }
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

  private requireAgent(
    principal: RemotePrincipal,
    args: Record<string, unknown>,
  ): RemoteAgentRecord {
    const agent = this.resolveAgent(principal.userId, asString(args.agent_id_or_alias) ?? "");
    if (!agent) {
      throw safeError("AGENT_NOT_FOUND", "Agent not found", 404);
    }
    this.requireVisibleAgent(principal, agent);
    return agent;
  }

  resolveAgent(userId: string, value: string): RemoteAgentRecord | undefined {
    if (!value) {
      return undefined;
    }
    const byId = this.store.getAgent(value);
    if (byId?.userId === userId) {
      return byId;
    }
    return this.store.getAgentByAlias(userId, value);
  }
}
