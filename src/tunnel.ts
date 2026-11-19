import net from "node:net";
import { createConnectionError } from "./errors.js";
import { logger } from "./logging.js";
import type { MetricsCollector } from "./metrics.js";
import type { PolicyEngine } from "./policy.js";
import type { SessionManager } from "./session.js";

export type TunnelType = "local" | "remote" | "dynamic";

export interface TunnelConfig {
  sessionId: string;
  type: TunnelType;
  localHost?: string;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
}

export interface TunnelInfo {
  id: string;
  sessionId: string;
  type: TunnelType;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  createdAt: number;
  active: boolean;
}

export interface TunnelService {
  createLocalForward(
    sessionId: string,
    localPort: number,
    remoteHost: string,
    remotePort: number,
  ): Promise<TunnelInfo>;
  createRemoteForward(
    sessionId: string,
    remotePort: number,
    localHost: string,
    localPort: number,
  ): Promise<TunnelInfo>;
  closeTunnel(tunnelId: string): Promise<boolean>;
  listTunnels(sessionId?: string): TunnelInfo[];
  closeSessionTunnels(sessionId: string): Promise<number>;
}

export interface TunnelServiceDeps {
  sessionManager: Pick<SessionManager, "getSession"> & {
    isSessionClosing?: (sessionId: string) => boolean;
    onSessionClose?: (callback: (sessionId: string) => Promise<void> | void) => void;
  };
  metrics: Pick<
    MetricsCollector,
    "recordTunnelOpened" | "recordTunnelClosed" | "recordTunnelError"
  >;
  policy: Pick<PolicyEngine, "assertAllowed">;
}

interface TunnelHandle {
  close(): Promise<void>;
  /** Recheck synchronous cleanup obligations at the registry-retirement boundary. */
  assertCleanupComplete?(): void;
}

/** A failed destroy is not cleared until the channel actually emits close. */
function trackedChannelCleanup<
  T extends { destroy(): unknown; once(event: "close", callback: () => void): unknown },
>(onFailure: (error: unknown) => void) {
  const failures = new Map<T, unknown>();
  const observed = new WeakSet<T>();
  const closed = new WeakSet<T>();
  return {
    destroy(channel: T): void {
      if (closed.has(channel)) return;
      if (!observed.has(channel)) {
        observed.add(channel);
        channel.once("close", () => {
          closed.add(channel);
          failures.delete(channel);
        });
      }
      try {
        channel.destroy();
      } catch (error) {
        // A synchronous close event is stronger evidence than a subsequent
        // exception from destroy(): do not resurrect an already-cleared error.
        if (!closed.has(channel)) {
          failures.set(channel, error);
          onFailure(error);
        }
      }
    },
    assertComplete(): void {
      const errors = [...failures.values()];
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "SSH channel destruction remains incomplete");
      }
    },
  };
}

class TunnelManager {
  private readonly tunnels = new Map<string, TunnelInfo>();
  private readonly handles = new Map<string, TunnelHandle>();
  private readonly closing = new Map<string, Promise<boolean>>();
  private readonly pendingCreations = new Map<string, Set<() => void>>();
  private tunnelCounter = 0;

  private trackPendingCreation(sessionId: string, cancel: () => void): () => void {
    let pending = this.pendingCreations.get(sessionId);
    if (!pending) {
      pending = new Set();
      this.pendingCreations.set(sessionId, pending);
    }
    pending.add(cancel);
    return () => {
      pending.delete(cancel);
      if (pending.size === 0) this.pendingCreations.delete(sessionId);
    };
  }

  constructor(
    private readonly sessionManager: TunnelServiceDeps["sessionManager"],
    private readonly metrics: Pick<
      MetricsCollector,
      "recordTunnelOpened" | "recordTunnelClosed" | "recordTunnelError"
    >,
    private readonly policy: Pick<PolicyEngine, "assertAllowed">,
  ) {}

  async createLocalTunnel(config: TunnelConfig): Promise<TunnelInfo> {
    const { sessionId, localPort, remoteHost = "localhost", remotePort } = config;
    const localHost = config.localHost ?? "localhost";

    logger.debug("Creating local tunnel", {
      sessionId,
      localPort,
      remoteHost,
      remotePort,
    });

    const session = this.sessionManager.getSession(sessionId);
    if (!session || this.sessionManager.isSessionClosing?.(sessionId)) {
      throw createConnectionError("Session not found or expired");
    }
    const decision = this.policy.assertAllowed({
      action: "tunnel.local",
      host: remoteHost,
      localBindHost: localHost,
      localPort,
      remoteHost,
      remotePort: remotePort ?? localPort,
      mode: session.info.policyMode,
    });
    if (decision.mode === "explain") {
      return {
        id: `tunnel-explain-${Date.now()}`,
        sessionId,
        type: "local",
        localHost,
        localPort,
        remoteHost,
        remotePort: remotePort ?? localPort,
        createdAt: Date.now(),
        active: false,
      };
    }

    const tunnelId = `tunnel-${Date.now()}-${++this.tunnelCounter}`;
    const targetPort = remotePort ?? localPort;
    const sockets = new Set<net.Socket>();
    type ForwardChannel = Awaited<ReturnType<typeof session.ssh.forwardOut>>;
    const channels = new Set<ForwardChannel>();
    let closing = false;
    let registered = false;
    const channelCleanup = trackedChannelCleanup<ForwardChannel>((error) => {
      this.metrics.recordTunnelError();
      logger.warn("Local tunnel channel cleanup failed", { tunnelId, error });
      if (closing && registered && !this.tunnels.has(tunnelId)) {
        // The listener was already closed while forwardOut was unresolved.
        // Restore a cleanup-only handle without reopening the TCP listener or
        // counting another tunnel as opened. A caller can retry by tunnel ID.
        this.tunnels.set(tunnelId, { ...tunnelInfo, active: false });
        this.handles.set(tunnelId, {
          close: stopLocalForward,
          assertCleanupComplete: channelCleanup.assertComplete,
        });
        logger.warn("Late local forwarding requires deferred channel cleanup", { tunnelId });
      }
    });
    const destroyChannel = channelCleanup.destroy;
    const server = net.createServer((socket) => {
      if (closing) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once("close", () => {
        sockets.delete(socket);
      });
      socket.on("error", (error) => {
        this.metrics.recordTunnelError();
        logger.error("Local tunnel socket error", { tunnelId, error });
        socket.destroy();
      });
      void session.ssh
        .forwardOut(
          socket.remoteAddress ?? localHost,
          socket.remotePort ?? 0,
          remoteHost,
          targetPort,
        )
        .then((channel) => {
          if (closing || socket.destroyed) {
            destroyChannel(channel);
            return;
          }
          channels.add(channel);
          socket.on("close", () => {
            channels.delete(channel);
            destroyChannel(channel);
          });
          channel.on("error", (error: Error) => {
            this.metrics.recordTunnelError();
            logger.error("Local tunnel channel failed", { tunnelId, error });
            socket.destroy();
          });
          channel.on("close", () => {
            channels.delete(channel);
            socket.destroy();
          });
          socket.pipe(channel).pipe(socket);
        })
        .catch((error) => {
          this.metrics.recordTunnelError();
          logger.error("Local tunnel forwarding failed", { tunnelId, error });
          socket.destroy();
        });
    });

    const stopLocalForward = async () => {
      closing = true;
      const listenerClosed = new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
      for (const socket of sockets) socket.destroy();
      for (const channel of channels) destroyChannel(channel);
      await listenerClosed;
      channelCleanup.assertComplete();
    };

    const finishPending = this.trackPendingCreation(sessionId, () => {
      closing = true;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(localPort, localHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (
        closing ||
        this.sessionManager.isSessionClosing?.(sessionId) ||
        !this.sessionManager.getSession(sessionId)
      ) {
        await stopLocalForward();
        throw createConnectionError("Session closed during local tunnel creation");
      }
    } finally {
      finishPending();
    }

    const tunnelInfo: TunnelInfo = {
      id: tunnelId,
      sessionId,
      type: "local",
      localHost,
      localPort,
      remoteHost,
      remotePort: targetPort,
      createdAt: Date.now(),
      active: true,
    };

    this.tunnels.set(tunnelId, tunnelInfo);
    this.handles.set(tunnelId, {
      close: stopLocalForward,
      assertCleanupComplete: channelCleanup.assertComplete,
    });
    registered = true;
    this.metrics.recordTunnelOpened();

    logger.info("Local tunnel created", {
      tunnelId,
      localPort,
      remoteHost,
      remotePort: targetPort,
    });

    return tunnelInfo;
  }

  async createRemoteTunnel(config: TunnelConfig): Promise<TunnelInfo> {
    const { sessionId, localPort, remoteHost = "localhost", remotePort } = config;
    const localHost = config.localHost ?? "localhost";

    logger.debug("Creating remote tunnel", {
      sessionId,
      localPort,
      remoteHost,
      remotePort,
    });

    const session = this.sessionManager.getSession(sessionId);
    if (!session || this.sessionManager.isSessionClosing?.(sessionId)) {
      throw createConnectionError("Session not found or expired");
    }
    const decision = this.policy.assertAllowed({
      action: "tunnel.remote",
      host: remoteHost,
      localBindHost: localHost,
      localPort,
      remoteHost,
      remotePort: remotePort ?? localPort,
      mode: session.info.policyMode,
    });
    if (decision.mode === "explain") {
      return {
        id: `tunnel-explain-${Date.now()}`,
        sessionId,
        type: "remote",
        localHost,
        localPort,
        remoteHost,
        remotePort: remotePort ?? localPort,
        createdAt: Date.now(),
        active: false,
      };
    }

    const tunnelId = `tunnel-${Date.now()}-${++this.tunnelCounter}`;
    const targetPort = remotePort ?? localPort;

    const connections = new Set<{ channel: import("ssh2").ClientChannel; socket: net.Socket }>();
    let closing = false;
    const channelCleanup = trackedChannelCleanup<import("ssh2").ClientChannel>((error) => {
      this.metrics.recordTunnelError();
      logger.warn("Remote tunnel channel cleanup failed", { tunnelId, error });
    });
    const destroyChannel = channelCleanup.destroy;
    const closeConnections = () => {
      for (const { socket, channel } of connections) {
        socket.destroy();
        destroyChannel(channel);
      }
    };

    const finishPending = this.trackPendingCreation(sessionId, () => {
      closing = true;
      closeConnections();
    });

    let forward: { port: number; dispose: () => Promise<void> };
    try {
      forward = await session.ssh.forwardIn(
        remoteHost,
        targetPort,
        (_details: unknown, accept: () => import("ssh2").ClientChannel) => {
          let channel: import("ssh2").ClientChannel;
          try {
            channel = accept();
          } catch {
            this.metrics.recordTunnelError();
            logger.error("Remote tunnel accept failed", { tunnelId, remoteHost, targetPort });
            return;
          }

          if (closing) {
            destroyChannel(channel);
            return;
          }
          const localSocket = net.connect(localPort, localHost);
          const connection = { channel, socket: localSocket };
          connections.add(connection);
          const releaseConnection = () => connections.delete(connection);
          localSocket.on("error", (error) => {
            this.metrics.recordTunnelError();
            logger.error("Remote tunnel local socket failed", { tunnelId, error });
            try {
              channel.close();
            } catch {
              // ignore close errors on already-destroyed channel
            }
          });
          localSocket.on("close", () => {
            releaseConnection();
            destroyChannel(channel);
          });
          channel.on("error", (error: Error) => {
            this.metrics.recordTunnelError();
            logger.error("Remote tunnel channel failed", { tunnelId, error });
            localSocket.destroy();
          });
          channel.on("close", () => {
            releaseConnection();
            localSocket.destroy();
          });
          channel.pipe(localSocket).pipe(channel);
        },
      );
    } catch (error) {
      closing = true;
      closeConnections();
      this.metrics.recordTunnelError();
      const message = error instanceof Error ? error.message : String(error);
      finishPending();
      throw createConnectionError(
        `Remote tunnel forward failed on ${remoteHost}:${targetPort}: ${message}`,
      );
    }

    let disposed = false;
    const closeForward = async () => {
      closing = true;
      closeConnections();
      if (!disposed) {
        await forward.dispose();
        disposed = true;
      }
      channelCleanup.assertComplete();
    };
    const tunnelInfo: TunnelInfo = {
      id: tunnelId,
      sessionId,
      type: "remote",
      localHost,
      localPort,
      remoteHost,
      remotePort: forward.port,
      createdAt: Date.now(),
      active: true,
    };
    const handle: TunnelHandle = { close: closeForward };
    try {
      if (
        closing ||
        this.sessionManager.isSessionClosing?.(sessionId) ||
        !this.sessionManager.getSession(sessionId)
      ) {
        try {
          await closeForward();
        } catch (error) {
          // The creation failed, but its SSH listener can still exist.
          // Keep it discoverable by listTunnels and retryable via closeTunnel.
          this.tunnels.set(tunnelId, tunnelInfo);
          this.handles.set(tunnelId, handle);
          this.metrics.recordTunnelOpened();
          this.metrics.recordTunnelError();
          logger.warn("Cancelled remote forwarding still needs cleanup", { tunnelId, error });
          throw createConnectionError(
            "Session closed during remote tunnel creation; pending cleanup for " + tunnelId,
          );
        }
        throw createConnectionError("Session closed during remote tunnel creation");
      }
    } finally {
      finishPending();
    }

    this.tunnels.set(tunnelId, tunnelInfo);
    this.handles.set(tunnelId, handle);
    this.metrics.recordTunnelOpened();

    logger.info("Remote tunnel created", {
      tunnelId,
      remotePort: targetPort,
      localHost,
      localPort,
    });

    return tunnelInfo;
  }

  async closeTunnel(tunnelId: string): Promise<boolean> {
    const inProgress = this.closing.get(tunnelId);
    if (inProgress) {
      return inProgress;
    }
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) {
      logger.warn("Tunnel not found", { tunnelId });
      return false;
    }

    const close = (async () => {
      const handle = this.handles.get(tunnelId);
      try {
        await handle?.close();
        // A late forwardOut may fail after close()'s last assertion but before
        // this await resumes. Keep that failure owned until retirement is safe.
        // No await is permitted between this check and registry deletion.
        handle?.assertCleanupComplete?.();
      } catch (error) {
        this.metrics.recordTunnelError();
        logger.warn("Tunnel close failed, retaining for retry", { tunnelId, error });
        throw error;
      }
      const wasActive = tunnel.active;
      tunnel.active = false;
      this.handles.delete(tunnelId);
      this.tunnels.delete(tunnelId);
      // An inactive cleanup-only record was already counted closed when its
      // listener was released; do not decrement active-tunnel metrics twice.
      if (wasActive) this.metrics.recordTunnelClosed();
      logger.info("Tunnel closed", { tunnelId });
      return true;
    })();
    this.closing.set(tunnelId, close);
    try {
      return await close;
    } finally {
      this.closing.delete(tunnelId);
    }
  }

  listTunnels(sessionId?: string): TunnelInfo[] {
    const tunnels = Array.from(this.tunnels.values());
    return sessionId ? tunnels.filter((tunnel) => tunnel.sessionId === sessionId) : tunnels;
  }

  async closeSessionTunnels(sessionId: string): Promise<number> {
    for (const cancel of this.pendingCreations.get(sessionId) ?? []) cancel();
    const sessionTunnels = this.listTunnels(sessionId);
    let closed = 0;

    const failures: unknown[] = [];
    for (const tunnel of sessionTunnels) {
      try {
        if (await this.closeTunnel(tunnel.id)) {
          closed++;
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Multiple tunnels failed to close");
    }
    return closed;
  }
}

export function createTunnelService({
  sessionManager,
  metrics,
  policy,
}: TunnelServiceDeps): TunnelService {
  const manager = new TunnelManager(sessionManager, metrics, policy);

  if (sessionManager.onSessionClose) {
    sessionManager.onSessionClose(async (sessionId) => {
      await manager.closeSessionTunnels(sessionId);
    });
  }

  return {
    createLocalForward(
      sessionId: string,
      localPort: number,
      remoteHost: string,
      remotePort: number,
    ): Promise<TunnelInfo> {
      return manager.createLocalTunnel({
        sessionId,
        type: "local",
        localPort,
        remoteHost,
        remotePort,
      });
    },
    createRemoteForward(
      sessionId: string,
      remotePort: number,
      localHost: string,
      localPort: number,
    ): Promise<TunnelInfo> {
      return manager.createRemoteTunnel({
        sessionId,
        type: "remote",
        localHost,
        localPort,
        remoteHost: "localhost",
        remotePort,
      });
    },
    closeTunnel(tunnelId: string): Promise<boolean> {
      return manager.closeTunnel(tunnelId);
    },
    listTunnels(sessionId?: string): TunnelInfo[] {
      return manager.listTunnels(sessionId);
    },
    closeSessionTunnels(sessionId: string): Promise<number> {
      return manager.closeSessionTunnels(sessionId);
    },
  };
}
