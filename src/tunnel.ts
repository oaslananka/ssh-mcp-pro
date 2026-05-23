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
  sessionManager: Pick<SessionManager, "getSession">;
  metrics: Pick<
    MetricsCollector,
    "recordTunnelOpened" | "recordTunnelClosed" | "recordTunnelError"
  >;
  policy: Pick<PolicyEngine, "assertAllowed">;
}

interface TunnelHandle {
  close(): Promise<void>;
}

class TunnelManager {
  private readonly tunnels = new Map<string, TunnelInfo>();
  private readonly handles = new Map<string, TunnelHandle>();
  private tunnelCounter = 0;

  constructor(
    private readonly sessionManager: Pick<SessionManager, "getSession">,
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
    if (!session) {
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
    const server = net.createServer((socket) => {
      void session.ssh
        .forwardOut(
          socket.remoteAddress ?? localHost,
          socket.remotePort ?? 0,
          remoteHost,
          targetPort,
        )
        .then((channel) => {
          socket.pipe(channel).pipe(socket);
        })
        .catch((error) => {
          this.metrics.recordTunnelError();
          logger.error("Local tunnel forwarding failed", { tunnelId, error });
          socket.destroy();
        });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(localPort, localHost, () => {
        server.off("error", reject);
        resolve();
      });
    });

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
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    });
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
    if (!session) {
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
    const forward = await session.ssh.forwardIn(remoteHost, targetPort, (_details, accept) => {
      const channel = accept();
      const localSocket = net.connect(localPort, localHost);
      channel.pipe(localSocket).pipe(channel);
      localSocket.on("error", (error) => {
        this.metrics.recordTunnelError();
        logger.error("Remote tunnel local socket failed", { tunnelId, error });
        channel.destroy();
      });
    });

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

    this.tunnels.set(tunnelId, tunnelInfo);
    this.handles.set(tunnelId, {
      close: () => forward.dispose(),
    });
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
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) {
      logger.warn("Tunnel not found", { tunnelId });
      return false;
    }

    tunnel.active = false;
    const handle = this.handles.get(tunnelId);
    if (handle) {
      await handle.close();
      this.handles.delete(tunnelId);
    }
    this.tunnels.delete(tunnelId);
    this.metrics.recordTunnelClosed();
    logger.info("Tunnel closed", { tunnelId });
    return true;
  }

  listTunnels(sessionId?: string): TunnelInfo[] {
    const tunnels = Array.from(this.tunnels.values());
    return sessionId ? tunnels.filter((tunnel) => tunnel.sessionId === sessionId) : tunnels;
  }

  async closeSessionTunnels(sessionId: string): Promise<number> {
    const sessionTunnels = this.listTunnels(sessionId);
    let closed = 0;

    for (const tunnel of sessionTunnels) {
      if (await this.closeTunnel(tunnel.id)) {
        closed++;
      }
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
