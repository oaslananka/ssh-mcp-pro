import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AuditEvent, RemoteAgentRecord, RemoteConfig } from "./types.js";
import { acceptWebSocketUpgrade, type WebSocketConnection } from "./websocket.js";

const DEFAULT_AGENT_HELLO_TIMEOUT_MS = 10_000;
const DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_AGENT_CONNECTIONS = 128;
const DEFAULT_MAX_AGENT_CONNECTIONS_PER_AGENT = 2;
const CLOSE_GRACE_MS = 1_000;

type LifecycleConfig = Pick<
  RemoteConfig,
  | "agentHelloTimeoutMs"
  | "agentHeartbeatIntervalMs"
  | "agentIdleTimeoutMs"
  | "maxAgentConnections"
  | "maxAgentConnectionsPerAgent"
>;

interface ManagedAgentConnection {
  connection: WebSocketConnection;
  lastActivityAt: number;
  authenticated: boolean;
  agentId?: string | undefined;
  helloTimeout?: NodeJS.Timeout | undefined;
  terminationTimeout?: NodeJS.Timeout | undefined;
}

interface AgentConnectionLifecycleCallbacks {
  onMessage(connection: WebSocketConnection, message: string): Promise<void>;
  onAuthenticatedClose(agentId: string, connection: WebSocketConnection, code: number): boolean;
  getAgent(agentId: string): RemoteAgentRecord | undefined;
}

/** Owns bounded WebSocket resource and timeout state independently of agent message handling. */
export class AgentConnectionLifecycle {
  private readonly managedConnections = new Map<WebSocketConnection, ManagedAgentConnection>();
  private readonly agentClaims = new Map<string, Set<WebSocketConnection>>();
  private readonly pendingUpgradeSockets = new Set<Duplex>();
  private readonly heartbeatInterval: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(
    private readonly config: LifecycleConfig,
    private readonly callbacks: AgentConnectionLifecycleCallbacks,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {
    this.heartbeatInterval = setInterval(
      () => this.runHeartbeat(),
      this.config.agentHeartbeatIntervalMs ?? DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS,
    );
    this.heartbeatInterval.unref?.();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer<ArrayBufferLike>): void {
    if (this.shuttingDown) {
      this.rejectRawUpgrade(socket, false);
      return;
    }
    if (!this.hasGlobalCapacity()) {
      this.rejectRawUpgrade(socket, true);
      return;
    }

    this.pendingUpgradeSockets.add(socket);
    const releasePending = () => this.pendingUpgradeSockets.delete(socket);
    socket.once("close", releasePending);
    socket.once("error", releasePending);

    try {
      acceptWebSocketUpgrade(req, socket, head, (connection) => {
        releasePending();
        this.attach(connection);
      });
    } catch {
      releasePending();
      socket.destroy();
    }
  }

  attach(connection: WebSocketConnection, now = Date.now()): boolean {
    if (this.shuttingDown) {
      this.rejectAcceptedConnection(connection);
      return false;
    }
    if (this.managedConnections.size >= this.maxConnections) {
      this.auditGlobalLimit();
      this.rejectAcceptedConnection(connection);
      return false;
    }

    const managed: ManagedAgentConnection = {
      connection,
      lastActivityAt: now,
      authenticated: false,
    };
    this.managedConnections.set(connection, managed);
    managed.helloTimeout = setTimeout(
      () => this.handleHelloTimeout(connection),
      this.config.agentHelloTimeoutMs ?? DEFAULT_AGENT_HELLO_TIMEOUT_MS,
    );
    managed.helloTimeout.unref?.();

    connection.onText((message) => this.receiveMessage(connection, message));
    connection.onPong(() => this.recordActivity(connection));
    connection.onClose((code) => this.handleClose(connection, code));
    return true;
  }

  claim(connection: WebSocketConnection, agent: RemoteAgentRecord): boolean {
    const managed = this.managedConnections.get(connection);
    if (!managed) {
      return true;
    }
    if (managed.agentId && managed.agentId !== agent.id) {
      connection.sendJson({
        type: "error",
        code: "FORBIDDEN",
        message: "Connection is already bound to another agent",
      });
      this.closeConnection(connection, 1008, "agent binding mismatch");
      return false;
    }

    const claims = this.agentClaims.get(agent.id) ?? new Set<WebSocketConnection>();
    if (!claims.has(connection) && claims.size >= this.maxConnectionsPerAgent) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_connection_limit_rejected",
        severity: "warn",
        metadata: { scope: "agent", max_connections: this.maxConnectionsPerAgent },
      });
      connection.sendJson({
        type: "error",
        code: "FORBIDDEN",
        message: "Agent connection limit reached",
      });
      this.closeConnection(connection, 1008, "agent connection limit reached");
      return false;
    }
    claims.add(connection);
    this.agentClaims.set(agent.id, claims);
    managed.agentId = agent.id;
    return true;
  }

  markAuthenticated(connection: WebSocketConnection, agentId: string): void {
    const managed = this.managedConnections.get(connection);
    if (!managed) {
      return;
    }
    managed.authenticated = true;
    managed.agentId = agentId;
    if (managed.helloTimeout) {
      clearTimeout(managed.helloTimeout);
      managed.helloTimeout = undefined;
    }
  }

  isManaged(connection: WebSocketConnection): boolean {
    return this.managedConnections.has(connection);
  }

  isAuthenticated(connection: WebSocketConnection): boolean {
    return this.managedConnections.get(connection)?.authenticated ?? false;
  }

  agentIdFor(connection: WebSocketConnection): string | undefined {
    return this.managedConnections.get(connection)?.agentId;
  }

  closeConnection(connection: WebSocketConnection, code: number, reason: string): void {
    const managed = this.managedConnections.get(connection);
    if (managed && !managed.terminationTimeout) {
      managed.terminationTimeout = setTimeout(() => connection.terminate(), CLOSE_GRACE_MS);
      managed.terminationTimeout.unref?.();
    }
    connection.close(code, reason);
  }

  runHeartbeat(now = Date.now()): void {
    if (this.shuttingDown) {
      return;
    }
    const idleTimeoutMs = this.config.agentIdleTimeoutMs ?? DEFAULT_AGENT_IDLE_TIMEOUT_MS;
    for (const managed of this.managedConnections.values()) {
      if (now - managed.lastActivityAt >= idleTimeoutMs) {
        const agent = managed.agentId ? this.callbacks.getAgent(managed.agentId) : undefined;
        this.audit({
          userId: agent?.userId,
          agentId: agent?.id,
          eventType: "agent_connection_idle_timeout",
          severity: "warn",
          metadata: { idle_timeout_ms: idleTimeoutMs, authenticated: managed.authenticated },
        });
        this.closeConnection(managed.connection, 1001, "idle timeout");
      } else {
        managed.connection.ping();
      }
    }
  }

  close(): void {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    clearInterval(this.heartbeatInterval);
    for (const socket of this.pendingUpgradeSockets) {
      socket.destroy();
    }
    this.pendingUpgradeSockets.clear();
    const managed = [...this.managedConnections.values()];
    this.managedConnections.clear();
    this.agentClaims.clear();
    for (const entry of managed) {
      if (entry.helloTimeout) {
        clearTimeout(entry.helloTimeout);
      }
      if (entry.terminationTimeout) {
        clearTimeout(entry.terminationTimeout);
      }
      entry.connection.terminate();
    }
  }

  get openConnectionCount(): number {
    return this.managedConnections.size;
  }

  get unauthenticatedConnectionCount(): number {
    let count = 0;
    for (const managed of this.managedConnections.values()) {
      if (!managed.authenticated) {
        count += 1;
      }
    }
    return count;
  }

  private receiveMessage(connection: WebSocketConnection, message: string): void {
    const managed = this.managedConnections.get(connection);
    if (!managed) {
      return;
    }
    managed.lastActivityAt = Date.now();
    void this.callbacks.onMessage(connection, message).catch(() => {
      connection.sendJson({
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Agent message failed",
      });
      this.closeConnection(connection, 1008, "invalid agent message");
    });
  }

  private recordActivity(connection: WebSocketConnection): void {
    const managed = this.managedConnections.get(connection);
    if (managed) {
      managed.lastActivityAt = Date.now();
    }
  }

  private handleHelloTimeout(connection: WebSocketConnection): void {
    const managed = this.managedConnections.get(connection);
    if (!managed || managed.authenticated) {
      return;
    }
    const agent = managed.agentId ? this.callbacks.getAgent(managed.agentId) : undefined;
    this.audit({
      userId: agent?.userId,
      agentId: agent?.id,
      eventType: "agent_hello_timeout",
      severity: "warn",
      metadata: { timeout_ms: this.config.agentHelloTimeoutMs ?? DEFAULT_AGENT_HELLO_TIMEOUT_MS },
    });
    connection.sendJson({
      type: "error",
      code: "AGENT_TIMEOUT",
      message: "Agent hello deadline exceeded",
    });
    this.closeConnection(connection, 1008, "agent hello deadline exceeded");
  }

  private handleClose(connection: WebSocketConnection, code: number): void {
    const managed = this.managedConnections.get(connection);
    if (!managed) {
      return;
    }
    this.managedConnections.delete(connection);
    if (managed.helloTimeout) {
      clearTimeout(managed.helloTimeout);
    }
    if (managed.terminationTimeout) {
      clearTimeout(managed.terminationTimeout);
    }
    this.releaseAgentClaim(managed.agentId, connection);
    if (this.shuttingDown) {
      return;
    }

    if (
      managed.authenticated &&
      managed.agentId &&
      this.callbacks.onAuthenticatedClose(managed.agentId, connection, code)
    ) {
      return;
    }
    this.audit({
      agentId: managed.agentId,
      eventType: "agent_connection_closed",
      severity: code === 1000 ? "info" : "warn",
      metadata: { authenticated: managed.authenticated, close_code: code },
    });
  }

  private hasGlobalCapacity(): boolean {
    return this.managedConnections.size + this.pendingUpgradeSockets.size < this.maxConnections;
  }

  private rejectRawUpgrade(socket: Duplex, auditCapacity: boolean): void {
    if (auditCapacity) {
      this.auditGlobalLimit();
    }
    if (!socket.destroyed) {
      socket.end(
        ["HTTP/1.1 503 Service Unavailable", "Connection: close", "Content-Length: 0", "", ""].join(
          "\r\n",
        ),
      );
    }
  }

  private rejectAcceptedConnection(connection: WebSocketConnection): void {
    const terminationTimeout = setTimeout(() => connection.terminate(), CLOSE_GRACE_MS);
    terminationTimeout.unref?.();
    connection.onClose(() => clearTimeout(terminationTimeout));
    connection.close(1013, "connection limit reached");
  }

  private auditGlobalLimit(): void {
    this.audit({
      eventType: "agent_connection_limit_rejected",
      severity: "warn",
      metadata: { scope: "global", max_connections: this.maxConnections },
    });
  }

  private releaseAgentClaim(agentId: string | undefined, connection: WebSocketConnection): void {
    if (!agentId) {
      return;
    }
    const claims = this.agentClaims.get(agentId);
    claims?.delete(connection);
    if (claims?.size === 0) {
      this.agentClaims.delete(agentId);
    }
  }

  private get maxConnections(): number {
    return this.config.maxAgentConnections ?? DEFAULT_MAX_AGENT_CONNECTIONS;
  }

  private get maxConnectionsPerAgent(): number {
    return this.config.maxAgentConnectionsPerAgent ?? DEFAULT_MAX_AGENT_CONNECTIONS_PER_AGENT;
  }
}
