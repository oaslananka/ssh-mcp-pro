import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentWebSocketHandler, type AgentConnection } from "../../src/remote/agent-handler.js";
import { generateEd25519PemKeyPair, nowIso, signEnvelope } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { RemoteStore } from "../../src/remote/store.js";
import type {
  AgentHelloEnvelope,
  AuditEvent,
  RemoteAgentRecord,
  RemoteConfig,
} from "../../src/remote/types.js";
import type {
  WebSocketCloseHandler,
  WebSocketConnection,
  WebSocketPongHandler,
  WebSocketTextHandler,
} from "../../src/remote/websocket.js";

const NOW = new Date("2026-07-23T19:00:00.000Z").getTime();

class FakeConnection implements WebSocketConnection {
  readonly sentJson: unknown[] = [];
  readonly sentText: string[] = [];
  readonly closeCalls: Array<{ code: number; reason: string }> = [];
  pingCount = 0;
  terminateCount = 0;
  isOpen = true;
  isClosed = false;
  autoClose = true;
  private readonly textHandlers = new Set<WebSocketTextHandler>();
  private readonly closeHandlers = new Set<WebSocketCloseHandler>();
  private readonly pongHandlers = new Set<WebSocketPongHandler>();

  onText(handler: WebSocketTextHandler): void {
    this.textHandlers.add(handler);
  }

  onClose(handler: WebSocketCloseHandler): void {
    this.closeHandlers.add(handler);
    if (this.isClosed) {
      handler(1006, "");
    }
  }

  onPong(handler: WebSocketPongHandler): void {
    this.pongHandlers.add(handler);
  }

  sendJson(value: unknown): void {
    if (this.isOpen) {
      this.sentJson.push(value);
    }
  }

  sendText(value: string): void {
    if (this.isOpen) {
      this.sentText.push(value);
    }
  }

  ping(): void {
    if (this.isOpen) {
      this.pingCount += 1;
    }
  }

  close(code = 1000, reason = ""): void {
    if (!this.isOpen && this.isClosed) {
      return;
    }
    this.closeCalls.push({ code, reason });
    if (this.autoClose) {
      this.emitClose(code, reason);
    }
  }

  terminate(): void {
    this.terminateCount += 1;
    this.emitClose(1006, "");
  }

  emitText(value: string): void {
    for (const handler of this.textHandlers) {
      handler(value);
    }
  }

  emitPong(): void {
    for (const handler of this.pongHandlers) {
      handler();
    }
  }

  emitClose(code = 1000, reason = ""): void {
    if (this.isClosed) {
      return;
    }
    this.isOpen = false;
    this.isClosed = true;
    for (const handler of this.closeHandlers) {
      handler(code, reason);
    }
  }
}

interface HandlerHarness {
  attachConnection(connection: WebSocketConnection, now?: number): boolean;
  handleAgentMessage(connection: WebSocketConnection, message: string): Promise<void>;
  handleAgentHello(connection: WebSocketConnection, hello: AgentHelloEnvelope): Promise<void>;
  runHeartbeat(now?: number): void;
}

interface TestHarness {
  handler: AgentWebSocketHandler;
  internals: HandlerHarness;
  store: RemoteStore;
  audits: Array<Omit<AuditEvent, "id" | "createdAt">>;
  agentConnections: Map<string, AgentConnection>;
}

function createHarness(overrides: Partial<RemoteConfig> = {}): TestHarness {
  const store = new RemoteStore(":memory:");
  const audits: Array<Omit<AuditEvent, "id" | "createdAt">> = [];
  const agentConnections = new Map<string, AgentConnection>();
  const handler = new AgentWebSocketHandler(
    {
      agentWsPath: "/api/agents/connect",
      agentHelloTimeoutMs: 1_000,
      agentHeartbeatIntervalMs: 10_000,
      agentIdleTimeoutMs: 2_000,
      maxAgentConnections: 3,
      maxAgentConnectionsPerAgent: 2,
      ...overrides,
    },
    store,
    agentConnections,
    new Map(),
    new Map(),
    (event) => audits.push(event),
  );
  return {
    handler,
    internals: handler as unknown as HandlerHarness,
    store,
    audits,
    agentConnections,
  };
}

function insertAgent(store: RemoteStore, id: string, publicKey: string): RemoteAgentRecord {
  const policy = createAgentPolicy("read-only");
  const agent: RemoteAgentRecord = {
    id,
    userId: "github:1",
    alias: id,
    status: "offline",
    publicKey,
    profile: policy.profile,
    policy,
    policyVersion: policy.version,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.insertAgent(agent);
  return agent;
}

function signedHello(
  agentId: string,
  privateKey: string,
  nonce: string,
  overrides: Partial<AgentHelloEnvelope> = {},
): AgentHelloEnvelope {
  const hello: AgentHelloEnvelope = {
    type: "agent.hello",
    agent_id: agentId,
    timestamp: nowIso(),
    nonce,
    capabilities: ["system.read"],
    agent_version: "1.2.0",
    host: { hostname: "agent-host", os: "Linux", arch: "x64", platform: "linux" },
    signature: "",
    ...overrides,
  };
  hello.signature = signEnvelope(hello as unknown as Record<string, unknown>, privateKey);
  return hello;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agent WebSocket lifecycle limits", () => {
  test("closes unauthenticated connections at the hello deadline", () => {
    const harness = createHarness();
    const connection = new FakeConnection();
    connection.autoClose = false;
    try {
      expect(harness.internals.attachConnection(connection, NOW)).toBe(true);
      expect(harness.handler.openConnectionCount).toBe(1);
      expect(harness.handler.unauthenticatedConnectionCount).toBe(1);

      vi.advanceTimersByTime(1_000);

      expect(connection.sentJson).toContainEqual(
        expect.objectContaining({ type: "error", code: "AGENT_TIMEOUT" }),
      );
      expect(connection.closeCalls).toContainEqual({
        code: 1008,
        reason: "agent hello deadline exceeded",
      });
      expect(harness.handler.openConnectionCount).toBe(1);
      vi.advanceTimersByTime(1_000);
      expect(connection.terminateCount).toBe(1);
      expect(harness.handler.openConnectionCount).toBe(0);
      expect(harness.audits).toContainEqual(
        expect.objectContaining({ eventType: "agent_hello_timeout", severity: "warn" }),
      );
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });

  test("rejects messages before agent hello", async () => {
    const harness = createHarness();
    const connection = new FakeConnection();
    try {
      harness.internals.attachConnection(connection, NOW);

      await harness.internals.handleAgentMessage(
        connection,
        JSON.stringify({ type: "action.result" }),
      );

      expect(connection.sentJson).toContainEqual(
        expect.objectContaining({ type: "error", code: "FORBIDDEN" }),
      );
      expect(connection.closeCalls.at(-1)).toEqual({
        code: 1008,
        reason: "agent hello required",
      });
      expect(harness.audits).toContainEqual(
        expect.objectContaining({ eventType: "agent_message_before_hello" }),
      );
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });

  test("keeps accepted resources bounded under connection floods", () => {
    const harness = createHarness({ maxAgentConnections: 3 });
    const connections = Array.from({ length: 20 }, () => new FakeConnection());
    try {
      const results = connections.map((connection) =>
        harness.internals.attachConnection(connection, NOW),
      );

      expect(results.filter(Boolean)).toHaveLength(3);
      expect(harness.handler.openConnectionCount).toBe(3);
      expect(
        connections
          .slice(3)
          .every((connection) => connection.closeCalls.some(({ code }) => code === 1013)),
      ).toBe(true);
      expect(
        harness.audits.filter(
          (event) =>
            event.eventType === "agent_connection_limit_rejected" &&
            event.metadata.scope === "global",
        ),
      ).toHaveLength(17);
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });

  test("rejects raw upgrades at capacity and during shutdown", () => {
    const harness = createHarness({ maxAgentConnections: 1 });
    const accepted = new FakeConnection();
    const capacitySocket = new PassThrough();
    const shutdownSocket = new PassThrough();
    const capacityEnd = vi.spyOn(capacitySocket, "end");
    const shutdownEnd = vi.spyOn(shutdownSocket, "end");
    try {
      expect(harness.internals.attachConnection(accepted, NOW)).toBe(true);
      expect(
        harness.handler.handleUpgrade(
          {} as IncomingMessage,
          capacitySocket,
          Buffer.alloc(0),
          "/api/agents/connect",
        ),
      ).toBe(true);
      expect(capacityEnd).toHaveBeenCalledWith(expect.stringContaining("503 Service Unavailable"));
      expect(harness.audits).toContainEqual(
        expect.objectContaining({
          eventType: "agent_connection_limit_rejected",
          metadata: expect.objectContaining({ scope: "global", max_connections: 1 }),
        }),
      );

      const auditCount = harness.audits.length;
      harness.handler.close();
      expect(
        harness.handler.handleUpgrade(
          {} as IncomingMessage,
          shutdownSocket,
          Buffer.alloc(0),
          "/api/agents/connect",
        ),
      ).toBe(true);
      expect(shutdownEnd).toHaveBeenCalledWith(expect.stringContaining("503 Service Unavailable"));
      expect(harness.audits).toHaveLength(auditCount);
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });

  test("marks an authenticated agent offline after its live connection closes", async () => {
    const harness = createHarness();
    const keys = generateEd25519PemKeyPair();
    const agent = insertAgent(harness.store, "agt_close", keys.publicKeyPem);
    const connection = new FakeConnection();
    try {
      harness.internals.attachConnection(connection, NOW);
      await harness.internals.handleAgentHello(
        connection,
        signedHello(agent.id, keys.privateKeyPem, "nonce-close"),
      );
      expect(harness.agentConnections.get(agent.id)?.connection).toBe(connection);

      connection.emitClose(1000, "normal close");

      expect(harness.agentConnections.has(agent.id)).toBe(false);
      expect(harness.store.getAgent(agent.id)?.status).toBe("offline");
      expect(harness.audits).toContainEqual(
        expect.objectContaining({
          eventType: "agent_disconnected",
          metadata: { close_code: 1000 },
        }),
      );
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });

  test("refreshes heartbeat activity and closes idle connections", () => {
    const harness = createHarness({ agentIdleTimeoutMs: 2_000 });
    const connection = new FakeConnection();
    try {
      harness.internals.attachConnection(connection, NOW);

      harness.internals.runHeartbeat(NOW + 1_000);
      expect(connection.pingCount).toBe(1);

      vi.setSystemTime(NOW + 1_000);
      connection.emitPong();
      harness.internals.runHeartbeat(NOW + 2_500);
      expect(connection.pingCount).toBe(2);

      harness.internals.runHeartbeat(NOW + 3_001);
      expect(connection.closeCalls.at(-1)).toEqual({ code: 1001, reason: "idle timeout" });
      expect(harness.audits).toContainEqual(
        expect.objectContaining({ eventType: "agent_connection_idle_timeout" }),
      );
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });

  test("bounds per-agent candidates while preserving replacement and replay checks", async () => {
    const harness = createHarness({ maxAgentConnections: 6, maxAgentConnectionsPerAgent: 2 });
    const keys = generateEd25519PemKeyPair();
    const agent = insertAgent(harness.store, "agt_limit", keys.publicKeyPem);
    const active = new FakeConnection();
    const stuckInvalid = new FakeConnection();
    stuckInvalid.autoClose = false;
    const rejected = new FakeConnection();
    const replacement = new FakeConnection();
    const replay = new FakeConnection();
    try {
      harness.internals.attachConnection(active, NOW);
      await harness.internals.handleAgentHello(
        active,
        signedHello(agent.id, keys.privateKeyPem, "nonce-active"),
      );
      expect(harness.agentConnections.get(agent.id)?.connection).toBe(active);

      harness.internals.attachConnection(stuckInvalid, NOW);
      await harness.internals.handleAgentHello(stuckInvalid, {
        ...signedHello(agent.id, keys.privateKeyPem, "nonce-invalid"),
        signature: "invalid-signature",
      });
      expect(stuckInvalid.closeCalls.at(-1)?.code).toBe(1008);

      harness.internals.attachConnection(rejected, NOW);
      await harness.internals.handleAgentHello(
        rejected,
        signedHello(agent.id, keys.privateKeyPem, "nonce-third"),
      );
      expect(rejected.sentJson).toContainEqual(
        expect.objectContaining({ code: "FORBIDDEN", message: "Agent connection limit reached" }),
      );
      expect(harness.agentConnections.get(agent.id)?.connection).toBe(active);
      expect(harness.audits).toContainEqual(
        expect.objectContaining({
          eventType: "agent_connection_limit_rejected",
          metadata: expect.objectContaining({ scope: "agent", max_connections: 2 }),
        }),
      );

      stuckInvalid.emitClose(1008, "invalid signature");
      harness.internals.attachConnection(replacement, NOW);
      await harness.internals.handleAgentHello(
        replacement,
        signedHello(agent.id, keys.privateKeyPem, "nonce-replacement"),
      );
      expect(harness.agentConnections.get(agent.id)?.connection).toBe(replacement);
      expect(active.closeCalls).toContainEqual({ code: 1000, reason: "connection replaced" });
      expect(harness.audits).toContainEqual(
        expect.objectContaining({ eventType: "agent_connection_replaced" }),
      );

      harness.internals.attachConnection(replay, NOW);
      await harness.internals.handleAgentHello(
        replay,
        signedHello(agent.id, keys.privateKeyPem, "nonce-active"),
      );
      expect(replay.sentJson).toContainEqual(
        expect.objectContaining({ code: "ACTION_REPLAY_DETECTED" }),
      );
      expect(harness.agentConnections.get(agent.id)?.connection).toBe(replacement);
    } finally {
      harness.handler.close();
      harness.store.close();
    }
  });
});
