import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { AgentConnectionLifecycle } from "./agent-connection-lifecycle.js";
import { nowIso, verifyEnvelope } from "./crypto.js";
import {
  AGENT_NONCE_TTL_MS,
  isRecord,
  pruneNonceWindow,
  hasSeenNonce,
  rememberNonce,
} from "./http-util.js";
import { RemoteStore } from "./store.js";
import { parseActionResultEnvelope, parseAgentHelloEnvelope } from "./schemas.js";
import type {
  ActionRecord,
  ActionResultEnvelope,
  AgentHelloEnvelope,
  AuditEvent,
  RemoteAgentRecord,
  RemoteConfig,
  RemoteErrorCode,
} from "./types.js";
import type { WebSocketConnection } from "./websocket.js";

export interface AgentConnection {
  agent: RemoteAgentRecord;
  connection: WebSocketConnection;
  seenNonces: Map<string, number>;
}

export interface PendingAction {
  action: ActionRecord;
  resolve: (value: ActionResultEnvelope) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/** Handles signed agent messages while delegating bounded socket state to the lifecycle manager. */
export class AgentWebSocketHandler {
  private readonly lifecycle: AgentConnectionLifecycle;

  constructor(
    private readonly config: Pick<
      RemoteConfig,
      | "agentWsPath"
      | "agentHelloTimeoutMs"
      | "agentHeartbeatIntervalMs"
      | "agentIdleTimeoutMs"
      | "maxAgentConnections"
      | "maxAgentConnectionsPerAgent"
    >,
    private readonly store: RemoteStore,
    private readonly agentConnections: Map<string, AgentConnection>,
    private readonly agentHelloNonces: Map<string, Map<string, number>>,
    private readonly pendingActions: Map<string, PendingAction>,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {
    this.lifecycle = new AgentConnectionLifecycle(
      config,
      {
        onMessage: (connection, message) => this.handleAgentMessage(connection, message),
        onAuthenticatedClose: (agentId, connection, code) =>
          this.handleLiveConnectionClosedById(agentId, connection, code),
        getAgent: (agentId) => this.store.getAgent(agentId),
      },
      audit,
    );
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer<ArrayBufferLike>,
    pathname: string,
  ): boolean {
    if (pathname !== this.config.agentWsPath) {
      return false;
    }
    this.lifecycle.handleUpgrade(req, socket, head);
    return true;
  }

  private attachConnection(connection: WebSocketConnection, now = Date.now()): boolean {
    return this.lifecycle.attach(connection, now);
  }

  private async handleAgentMessage(
    connection: WebSocketConnection,
    message: string,
  ): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(message) as unknown;
    } catch {
      this.rejectInvalidMessage(connection, "Invalid message", "invalid agent message");
      return;
    }
    if (!isRecord(payload)) {
      this.rejectInvalidMessage(connection, "Invalid message", "invalid agent message");
      return;
    }
    if (payload.type === "agent.hello") {
      await this.handleAgentHello(connection, parseAgentHelloEnvelope(payload));
      return;
    }
    if (this.lifecycle.isManaged(connection) && !this.lifecycle.isAuthenticated(connection)) {
      this.audit({
        agentId: this.lifecycle.agentIdFor(connection),
        eventType: "agent_message_before_hello",
        severity: "warn",
        metadata: {},
      });
      connection.sendJson({
        type: "error",
        code: "FORBIDDEN",
        message: "Agent hello is required before other messages",
      });
      this.lifecycle.closeConnection(connection, 1008, "agent hello required");
      return;
    }
    if (payload.type === "action.result") {
      await this.handleActionResult(connection, parseActionResultEnvelope(payload));
      return;
    }
    this.rejectInvalidMessage(connection, "Unknown message type", "unknown agent message");
  }

  private rejectInvalidMessage(
    connection: WebSocketConnection,
    message: string,
    closeReason: string,
  ): void {
    connection.sendJson({ type: "error", code: "INTERNAL_ERROR", message });
    this.lifecycle.closeConnection(connection, 1008, closeReason);
  }

  private async handleAgentHello(
    connection: WebSocketConnection,
    hello: AgentHelloEnvelope,
  ): Promise<void> {
    const agent = this.store.getAgent(hello.agent_id);
    if (!agent || agent.status === "revoked" || !agent.publicKey) {
      connection.sendJson({
        type: "error",
        code: "AGENT_NOT_FOUND",
        message: "Agent is not enrolled",
      });
      this.lifecycle.closeConnection(connection, 1008, "agent not enrolled");
      return;
    }
    if (!this.lifecycle.claim(connection, agent)) {
      return;
    }
    if (!verifyEnvelope(hello as unknown as Record<string, unknown>, agent.publicKey)) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_signature_invalid",
        severity: "warn",
        metadata: { message_type: "agent.hello" },
      });
      connection.sendJson({
        type: "error",
        code: "SIGNATURE_INVALID",
        message: "Agent signature is invalid",
      });
      this.lifecycle.closeConnection(connection, 1008, "invalid agent signature");
      return;
    }
    if (this.isStaleHello(hello)) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_hello_expired",
        severity: "warn",
        metadata: {},
      });
      connection.sendJson({
        type: "error",
        code: "ACTION_EXPIRED",
        message: "Agent hello timestamp is stale",
      });
      this.lifecycle.closeConnection(connection, 1008, "stale agent hello");
      return;
    }

    const now = Date.now();
    this.cleanupEphemeralState(now);
    const existingConnection = this.agentConnections.get(agent.id);
    if (existingConnection?.connection === connection) {
      this.rejectDuplicateHello(
        connection,
        agent,
        "Agent hello was already processed on this connection",
      );
      return;
    }
    if (this.hasReplayedHello(agent, hello, now)) {
      connection.sendJson({
        type: "error",
        code: "ACTION_REPLAY_DETECTED",
        message: "Agent hello nonce was already used",
      });
      this.lifecycle.closeConnection(connection, 1008, "replayed agent hello");
      return;
    }

    const seenNonces = new Map<string, number>();
    rememberNonce(seenNonces, hello.nonce, now);
    this.agentConnections.set(agent.id, { agent, connection, seenNonces });
    this.lifecycle.markAuthenticated(connection, agent.id);
    this.replaceExistingConnection(existingConnection, agent);

    const online: RemoteAgentRecord = {
      ...agent,
      status: "online",
      lastSeenAt: nowIso(),
      hostMetadata: hello.host,
      updatedAt: nowIso(),
    };
    this.store.updateAgent(online);
    if (!this.lifecycle.isManaged(connection)) {
      connection.onClose((code) => this.handleLiveConnectionClosed(agent, connection, code));
    }
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_connected",
      severity: "info",
      metadata: {},
    });
    connection.sendJson({ type: "agent.ready", agent_id: agent.id, policy: agent.policy });
  }

  private isStaleHello(hello: AgentHelloEnvelope): boolean {
    const timestamp = new Date(hello.timestamp).getTime();
    return !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 300_000;
  }

  private rejectDuplicateHello(
    connection: WebSocketConnection,
    agent: RemoteAgentRecord,
    message: string,
  ): void {
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_duplicate_hello_rejected",
      severity: "warn",
      metadata: {},
    });
    connection.sendJson({ type: "error", code: "ACTION_REPLAY_DETECTED", message });
    this.lifecycle.closeConnection(connection, 1008, "duplicate agent hello");
  }

  private hasReplayedHello(
    agent: RemoteAgentRecord,
    hello: AgentHelloEnvelope,
    now: number,
  ): boolean {
    const helloNonces = this.agentHelloNonces.get(agent.id) ?? new Map<string, number>();
    if (helloNonces.has(hello.nonce)) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_hello_replay_detected",
        severity: "warn",
        metadata: {},
      });
      return true;
    }
    helloNonces.set(hello.nonce, now + AGENT_NONCE_TTL_MS);
    this.agentHelloNonces.set(agent.id, helloNonces);
    return false;
  }

  private replaceExistingConnection(
    existingConnection: AgentConnection | undefined,
    agent: RemoteAgentRecord,
  ): void {
    if (!existingConnection) {
      return;
    }
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_connection_replaced",
      severity: "info",
      metadata: {},
    });
    this.lifecycle.closeConnection(existingConnection.connection, 1000, "connection replaced");
  }

  private async handleActionResult(
    connection: WebSocketConnection,
    result: ActionResultEnvelope,
  ): Promise<void> {
    const pending = this.pendingActions.get(result.action_id);
    if (!pending) {
      return;
    }
    const agent = this.store.getAgent(result.agent_id);
    if (
      !agent?.publicKey ||
      !verifyEnvelope(result as unknown as Record<string, unknown>, agent.publicKey)
    ) {
      this.rejectPendingAction(pending, result.action_id, "agent_result_signature_invalid");
      pending.reject(new Error("Agent result signature is invalid"));
      return;
    }
    const live = this.agentConnections.get(result.agent_id);
    if (pending.action.agentId !== result.agent_id || live?.connection !== connection) {
      this.rejectPendingAction(pending, result.action_id, "agent_result_connection_invalid");
      pending.reject(
        Object.assign(new Error("Agent result came from an unexpected connection"), {
          code: "SIGNATURE_INVALID" satisfies RemoteErrorCode,
        }),
      );
      return;
    }
    const now = Date.now();
    if (hasSeenNonce(live.seenNonces, result.nonce, now)) {
      this.rejectPendingAction(pending, result.action_id, "agent_result_replay_detected");
      pending.reject(
        Object.assign(new Error("Agent result nonce was already used"), {
          code: "ACTION_REPLAY_DETECTED" satisfies RemoteErrorCode,
        }),
      );
      return;
    }
    rememberNonce(live.seenNonces, result.nonce, now);
    clearTimeout(pending.timeout);
    this.pendingActions.delete(result.action_id);
    pending.resolve(result);
  }

  private rejectPendingAction(pending: PendingAction, actionId: string, eventType: string): void {
    clearTimeout(pending.timeout);
    this.pendingActions.delete(actionId);
    this.audit({
      userId: pending.action.userId,
      agentId: pending.action.agentId,
      actionId: pending.action.id,
      eventType,
      severity: "warn",
      metadata: {},
    });
  }

  private handleLiveConnectionClosedById(
    agentId: string,
    connection: WebSocketConnection,
    closeCode: number,
  ): boolean {
    const agent = this.store.getAgent(agentId);
    return agent ? this.handleLiveConnectionClosed(agent, connection, closeCode) : false;
  }

  private handleLiveConnectionClosed(
    agent: RemoteAgentRecord,
    connection: WebSocketConnection,
    closeCode: number,
  ): boolean {
    const live = this.agentConnections.get(agent.id);
    if (live?.connection !== connection) {
      return false;
    }
    this.agentConnections.delete(agent.id);
    const latest = this.store.getAgent(agent.id);
    if (latest && latest.status !== "revoked") {
      this.store.updateAgent({ ...latest, status: "offline", updatedAt: nowIso() });
    }
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_disconnected",
      severity: "info",
      metadata: { close_code: closeCode },
    });
    return true;
  }

  private runHeartbeat(now = Date.now()): void {
    this.lifecycle.runHeartbeat(now);
  }

  cleanupEphemeralState(now = Date.now()): void {
    for (const [agentId, nonces] of this.agentHelloNonces.entries()) {
      pruneNonceWindow(nonces, now);
      if (nonces.size === 0) {
        this.agentHelloNonces.delete(agentId);
      }
    }
    for (const live of this.agentConnections.values()) {
      pruneNonceWindow(live.seenNonces, now);
    }
  }

  close(): void {
    this.lifecycle.close();
  }

  /** Number of currently authenticated agents. */
  get connectedAgentCount(): number {
    return this.agentConnections.size;
  }

  /** Number of accepted WebSocket connections, authenticated or not. */
  get openConnectionCount(): number {
    return this.lifecycle.openConnectionCount;
  }

  /** Number of accepted WebSocket connections still waiting for agent.hello. */
  get unauthenticatedConnectionCount(): number {
    return this.lifecycle.unauthenticatedConnectionCount;
  }
}
