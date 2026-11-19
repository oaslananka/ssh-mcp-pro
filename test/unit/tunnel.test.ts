import { describe, expect, vi, test } from "vitest";
import net from "node:net";
import { PassThrough } from "node:stream";
import { createTunnelService } from "../../src/tunnel.js";
import { createAllowPolicy, createSessionInfo, createTunnelMetrics } from "./helpers.js";

describe("createTunnelService", () => {
  test("creates, lists, and closes tunnels", async () => {
    const dispose = vi.fn(async () => undefined);
    const policy = createAllowPolicy();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: vi.fn(async (_host: string, port: number) => ({ port, dispose })),
              forwardOut: vi.fn(),
            },
          }) as any,
      },
      metrics: createTunnelMetrics(),
      policy,
    });

    const local = await service.createLocalForward("session-1", 0, "db", 5432);
    const remote = await service.createRemoteForward("session-1", 9000, "localhost", 3000);

    expect(service.listTunnels()).toHaveLength(2);
    expect(service.listTunnels("session-1")).toEqual(expect.arrayContaining([local, remote]));
    expect(policy.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tunnel.local",
        host: "db",
        localBindHost: "localhost",
        localPort: 0,
        remoteHost: "db",
        remotePort: 5432,
      }),
    );
    expect(policy.assertAllowed.mock.calls[0]?.[0]).not.toHaveProperty("path");
    await expect(service.closeTunnel(local.id)).resolves.toBe(true);
    await expect(service.closeSessionTunnels("session-1")).resolves.toBe(1);
  });

  test("throws when the backing session is missing", async () => {
    const service = createTunnelService({
      sessionManager: {
        getSession: () => undefined,
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });

    await expect(service.createLocalForward("missing", 8080, "db", 5432)).rejects.toThrow(
      "Session not found or expired",
    );
  });

  test("returns inactive plans in explain mode without opening sockets", async () => {
    const metrics = createTunnelMetrics();
    const policy = createAllowPolicy();
    const ssh = {
      forwardIn: vi.fn(),
      forwardOut: vi.fn(),
    };
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo({ policyMode: "explain" }),
            ssh,
          }) as any,
      },
      metrics,
      policy,
    });

    const local = await service.createLocalForward("session-1", 8080, "db", 5432);
    const remote = await service.createRemoteForward("session-1", 9000, "localhost", 3000);

    expect(local).toEqual(
      expect.objectContaining({
        active: false,
        type: "local",
        localPort: 8080,
        remoteHost: "db",
        remotePort: 5432,
      }),
    );
    expect(remote).toEqual(
      expect.objectContaining({
        active: false,
        type: "remote",
        localHost: "localhost",
        localPort: 3000,
        remoteHost: "localhost",
        remotePort: 9000,
      }),
    );
    expect(service.listTunnels()).toEqual([]);
    expect(ssh.forwardIn).not.toHaveBeenCalled();
    expect(ssh.forwardOut).not.toHaveBeenCalled();
    expect(metrics.recordTunnelOpened).not.toHaveBeenCalled();
  });

  test("returns false for unknown tunnels and zero for sessions without tunnels", async () => {
    const service = createTunnelService({
      sessionManager: {
        getSession: () => undefined,
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });

    await expect(service.closeTunnel("missing")).resolves.toBe(false);
    await expect(service.closeSessionTunnels("session-without-tunnels")).resolves.toBe(0);
    expect(service.listTunnels("session-without-tunnels")).toEqual([]);
  });

  test("destroys a forwardOut channel that arrives after its local socket closes", async () => {
    const listener = net.createServer();
    await new Promise<void>((resolve) => listener.listen(0, "localhost", resolve));
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    await new Promise<void>((resolve) => listener.close(() => resolve()));

    let resolveForward: ((channel: PassThrough) => void) | undefined;
    const forwardOut = vi.fn(
      () =>
        new Promise<PassThrough>((resolve) => {
          resolveForward = resolve;
        }),
    );
    const service = createTunnelService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { forwardOut } }) as any,
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createLocalForward("session-1", address.port, "127.0.0.1", 1234);
    const client = net.connect(address.port, "localhost");
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await vi.waitFor(() => expect(forwardOut).toHaveBeenCalledTimes(1));
      client.destroy();
      await new Promise<void>((resolve) => client.once("close", resolve));
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);

      const channel = new PassThrough();
      const destroy = vi.spyOn(channel, "destroy");
      const pipe = vi.spyOn(channel, "pipe");
      resolveForward?.(channel);
      await vi.waitFor(() => expect(destroy).toHaveBeenCalled(), { timeout: 500 });
      expect(pipe).not.toHaveBeenCalled();
    } finally {
      client.destroy();
      await service.closeTunnel(tunnel.id);
    }
  });

  test("finishes local shutdown with an active TCP client and pending SSH forwarding", async () => {
    const freePortServer = net.createServer();
    await new Promise<void>((resolve) => freePortServer.listen(0, "localhost", resolve));
    const address = freePortServer.address();
    if (!address || typeof address === "string") throw new Error("Missing free port");
    await new Promise<void>((resolve) => freePortServer.close(() => resolve()));

    const forwardOut = vi.fn(() => new Promise<PassThrough>(() => undefined));
    const service = createTunnelService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { forwardOut } }) as any,
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createLocalForward("session-1", address.port, "localhost", 4444);
    const client = net.connect(address.port, "localhost");
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await vi.waitFor(() => expect(forwardOut).toHaveBeenCalledOnce());
      const close = service.closeTunnel(tunnel.id);
      await expect(close).resolves.toBe(true);
      await vi.waitFor(() => expect(client.destroyed).toBe(true));
      expect(service.listTunnels()).toEqual([]);
    } finally {
      client.destroy();
      await service.closeTunnel(tunnel.id);
    }
  });

  test("shares concurrent tunnel close and records closure only once", async () => {
    const dispose = vi.fn(async () => undefined);
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: vi.fn(async (_host: string, port: number) => ({ port, dispose })),
            },
          }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createRemoteForward("session-1", 12345, "127.0.0.1", 5432);
    const first = service.closeTunnel(tunnel.id);
    const second = service.closeTunnel(tunnel.id);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(metrics.recordTunnelClosed).toHaveBeenCalledTimes(1);
    expect(service.listTunnels()).toEqual([]);
  });

  test("closes accepted remote forwarding channels and rejects late callbacks", async () => {
    const serverSockets = new Set<net.Socket>();
    const target = net.createServer((socket) => {
      serverSockets.add(socket);
      socket.once("close", () => serverSockets.delete(socket));
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("No target port");
    let onForward: ((details: unknown, accept: () => PassThrough) => void) | undefined;
    const dispose = vi.fn(async () => undefined);
    const forwardIn = vi.fn(
      async (
        _host: string,
        port: number,
        onConnection: (details: unknown, accept: () => PassThrough) => void,
      ) => {
        onForward = onConnection;
        return { port, dispose };
      },
    );
    const service = createTunnelService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { forwardIn } }) as any,
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createRemoteForward("session-1", 15001, "127.0.0.1", address.port);
    try {
      const channel = new PassThrough();
      channel.on("error", () => undefined);
      if (!onForward) throw new Error("Missing forwarded connection callback");
      onForward({}, () => channel);
      await vi.waitFor(() => expect(serverSockets.size).toBe(1));
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      await vi.waitFor(() => expect(serverSockets.size).toBe(0));
      expect(channel.destroyed).toBe(true);
      expect(dispose).toHaveBeenCalledOnce();

      const lateChannel = new PassThrough();
      const lateDestroy = vi.spyOn(lateChannel, "destroy");
      onForward({}, () => lateChannel);
      await vi.waitFor(() => expect(lateDestroy).toHaveBeenCalled());
      expect(serverSockets.size).toBe(0);
    } finally {
      for (const socket of serverSockets) socket.destroy();
      await service.closeTunnel(tunnel.id);
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  test("retains an accurate active tunnel state when close fails and can retry", async () => {
    const dispose = vi
      .fn()
      .mockRejectedValueOnce(new Error("forward dispose error"))
      .mockResolvedValue(undefined);
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: vi.fn(async (_host: string, port: number) => ({ port, dispose })),
            },
          }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createRemoteForward("session-1", 12346, "127.0.0.1", 5432);
    await expect(service.closeTunnel(tunnel.id)).rejects.toThrow("forward dispose error");
    expect(service.listTunnels()).toEqual([expect.objectContaining({ active: true })]);
    await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(metrics.recordTunnelClosed).toHaveBeenCalledTimes(1);
  });

  test("continues closing other tunnels if one remote disposal fails", async () => {
    const disposeFailed = vi.fn(async () => {
      throw new Error("dispose unavailable");
    });
    const disposeHealthy = vi.fn(async () => undefined);
    const forwardIn = vi.fn(async (_host: string, port: number) => ({
      port,
      dispose: port === 13001 ? disposeFailed : disposeHealthy,
    }));
    const service = createTunnelService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { forwardIn } }) as any,
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });
    const bad = await service.createRemoteForward("session-1", 13001, "localhost", 5432);
    await service.createRemoteForward("session-1", 13002, "localhost", 5432);
    await expect(service.closeSessionTunnels("session-1")).rejects.toThrow("dispose unavailable");
    expect(disposeFailed).toHaveBeenCalledOnce();
    expect(disposeHealthy).toHaveBeenCalledOnce();
    expect(service.listTunnels()).toEqual([expect.objectContaining({ id: bad.id, active: true })]);
  });

  test("does not register a local listener after its session closes during bind", async () => {
    let notifyClose: ((sessionId: string) => Promise<void> | void) | undefined;
    const session = { info: createSessionInfo(), ssh: { forwardOut: vi.fn() } };
    const service = createTunnelService({
      sessionManager: {
        getSession: () => session as any,
        onSessionClose: (callback) => {
          notifyClose = callback;
        },
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });
    const creation = service.createLocalForward("session-1", 0, "localhost", 443);
    if (!notifyClose) throw new Error("Missing session close hook");
    await notifyClose("session-1");
    try {
      await expect(creation).rejects.toThrow(/session|clos/i);
      expect(service.listTunnels("session-1")).toEqual([]);
    } finally {
      const late = await creation.catch(() => undefined);
      if (late) await service.closeTunnel(late.id);
    }
  });

  test("does not retain an in-flight remote listener after its session closes", async () => {
    let finishForward:
      ((forward: { port: number; dispose: () => Promise<void> }) => void) | undefined;
    let notifyClose: ((sessionId: string) => Promise<void> | void) | undefined;
    const dispose = vi.fn(async () => undefined);
    let onForward: ((details: unknown, accept: () => PassThrough) => void) | undefined;
    const forwardIn = vi.fn(
      (
        _host: string,
        _port: number,
        onConnection: (details: unknown, accept: () => PassThrough) => void,
      ) => {
        onForward = onConnection;
        return new Promise<{ port: number; dispose: () => Promise<void> }>((resolve) => {
          finishForward = resolve;
        });
      },
    );
    const session = { info: createSessionInfo(), ssh: { forwardIn } };
    const service = createTunnelService({
      sessionManager: {
        getSession: () => session as any,
        onSessionClose: (callback) => {
          notifyClose = callback;
        },
      },
      metrics: createTunnelMetrics(),
      policy: createAllowPolicy(),
    });
    const creation = service.createRemoteForward("session-1", 15300, "127.0.0.1", 5432);
    await vi.waitFor(() => expect(forwardIn).toHaveBeenCalledOnce());
    if (!notifyClose || !finishForward) throw new Error("Missing pending session hook");
    await notifyClose("session-1");
    const lateChannel = new PassThrough();
    if (!onForward) throw new Error("Missing forwarding callback");
    onForward({}, () => lateChannel);
    expect(lateChannel.destroyed).toBe(true);
    finishForward({ port: 15300, dispose });
    await expect(creation).rejects.toThrow(/session|clos/i);
    expect(dispose).toHaveBeenCalledOnce();
    expect(service.listTunnels("session-1")).toEqual([]);
  });

  test("retains a local tunnel after a channel destruction exception until close is observed", async () => {
    const freePort = net.createServer();
    await new Promise<void>((resolve) => freePort.listen(0, "localhost", resolve));
    const address = freePort.address();
    if (!address || typeof address === "string") throw new Error("Missing local port");
    await new Promise<void>((resolve) => freePort.close(() => resolve()));

    const channel = new PassThrough();
    channel.destroy = vi.fn(() => {
      throw new Error("channel destroy failed");
    }) as any;
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({ info: createSessionInfo(), ssh: { forwardOut: vi.fn(async () => channel) } }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createLocalForward("session-1", address.port, "localhost", 22);
    const client = net.connect(address.port, "localhost");
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await vi.waitFor(() => expect(channel.listenerCount("close")).toBeGreaterThan(0));
      await expect(service.closeTunnel(tunnel.id)).rejects.toThrow("channel destroy failed");
      expect(service.listTunnels("session-1")).toEqual([
        expect.objectContaining({ id: tunnel.id, active: true }),
      ]);
      expect(metrics.recordTunnelClosed).not.toHaveBeenCalled();
      // A later non-throwing destroy does not prove the failed SSH protocol close completed.
      channel.destroy = vi.fn(() => channel) as any;
      await expect(service.closeTunnel(tunnel.id)).rejects.toThrow("channel destroy failed");

      channel.emit("close");
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
    }
  });

  test("keeps failed cleanup of a late local forwardOut discoverable after listener shutdown", async () => {
    const reserved = net.createServer();
    await new Promise<void>((resolve) => reserved.listen(0, "localhost", resolve));
    const address = reserved.address();
    if (!address || typeof address === "string") throw new Error("Missing free port");
    await new Promise<void>((resolve) => reserved.close(() => resolve()));

    let resolveForward: ((channel: PassThrough) => void) | undefined;
    const forwardOut = vi.fn(
      () =>
        new Promise<PassThrough>((resolve) => {
          resolveForward = resolve;
        }),
    );
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { forwardOut } }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createLocalForward("session-1", address.port, "localhost", 22);
    const client = net.connect(address.port, "localhost");
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await vi.waitFor(() => expect(forwardOut).toHaveBeenCalledOnce());
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      expect(service.listTunnels("session-1")).toEqual([]);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();

      // The listener must be reusable without waiting for the outstanding forwardOut.
      const reuse = net.createServer();
      try {
        await new Promise<void>((resolve) => reuse.listen(address.port, "localhost", resolve));
      } finally {
        await new Promise<void>((resolve) => reuse.close(() => resolve()));
      }
      const channel = new PassThrough();
      channel.destroy = vi.fn(() => {
        throw new Error("late local channel destroy failed");
      }) as any;
      if (!resolveForward) throw new Error("Missing pending forwardOut");
      resolveForward(channel);
      await vi.waitFor(() =>
        expect(service.listTunnels("session-1")).toEqual([
          expect.objectContaining({ id: tunnel.id, active: false }),
        ]),
      );
      await expect(service.closeTunnel(tunnel.id)).rejects.toThrow(
        "late local channel destroy failed",
      );
      await expect(service.closeSessionTunnels("session-1")).rejects.toThrow(
        "late local channel destroy failed",
      );
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
      // A real close event, rather than a repeated non-throwing destroy, clears the failure.
      channel.emit("close");
      await expect(service.closeSessionTunnels("session-1")).resolves.toBe(1);
      expect(service.listTunnels("session-1")).toEqual([]);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
    }
  });

  test("keeps a failed late channel discoverable between final close check and registry retirement", async () => {
    const reserved = net.createServer();
    await new Promise<void>((resolve) => reserved.listen(0, "localhost", resolve));
    const address = reserved.address();
    if (!address || typeof address === "string") throw new Error("Missing free port");
    await new Promise<void>((resolve) => reserved.close(() => resolve()));

    let resolveForward: ((channel: PassThrough) => void) | undefined;
    const forwardOut = vi.fn(
      () =>
        new Promise<PassThrough>((resolve) => {
          resolveForward = resolve;
        }),
    );
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { forwardOut } }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createLocalForward("session-1", address.port, "localhost", 22);
    const client = net.connect(address.port, "localhost");
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await vi.waitFor(() => expect(forwardOut).toHaveBeenCalledOnce());

      const channel = new PassThrough();
      channel.destroy = vi.fn(() => {
        throw new Error("post-check channel destruction failed");
      }) as any;
      const realClose = net.Server.prototype.close;
      // The close callback resolves the listener shutdown; fulfilling forwardOut
      // immediately afterwards queues its channel cleanup between that final
      // check and closeTunnel's continuation which retires the registry record.
      const spy = vi.spyOn(net.Server.prototype, "close").mockImplementation(function (
        this: net.Server,
        callback?: (error?: Error) => void,
      ) {
        return realClose.call(this, (error?: Error) => {
          callback?.(error);
          resolveForward?.(channel);
        });
      });
      try {
        await expect(service.closeTunnel(tunnel.id)).rejects.toThrow(
          "post-check channel destruction failed",
        );
      } finally {
        spy.mockRestore();
      }
      expect(service.listTunnels("session-1")).toEqual([
        expect.objectContaining({ id: tunnel.id }),
      ]);
      expect(metrics.recordTunnelClosed).not.toHaveBeenCalled();
      await expect(service.closeSessionTunnels("session-1")).rejects.toThrow(
        "post-check channel destruction failed",
      );
      channel.emit("close");
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
      expect(service.listTunnels("session-1")).toEqual([]);
    } finally {
      client.destroy();
    }
  });

  test("accepts close-before-throw as completed local channel destruction", async () => {
    const reserved = net.createServer();
    await new Promise<void>((resolve) => reserved.listen(0, "localhost", resolve));
    const address = reserved.address();
    if (!address || typeof address === "string") throw new Error("Missing free port");
    await new Promise<void>((resolve) => reserved.close(() => resolve()));

    const channel = new PassThrough();
    channel.destroy = vi.fn(() => {
      channel.emit("close");
      throw new Error("destroy threw after close");
    }) as any;
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { forwardOut: vi.fn(async () => channel) },
          }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createLocalForward("session-1", address.port, "localhost", 22);
    const client = net.connect(address.port, "localhost");
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await vi.waitFor(() => expect(channel.listenerCount("close")).toBeGreaterThan(0));
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      expect(service.listTunnels()).toEqual([]);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
    }
  });

  test("does not treat failed remote channel destroy as successful forwarding closure", async () => {
    const target = net.createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Missing remote test port");
    let onForward: ((details: unknown, accept: () => PassThrough) => void) | undefined;
    const dispose = vi.fn(async () => undefined);
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: vi.fn(
                async (
                  _host: string,
                  port: number,
                  callback: (details: unknown, accept: () => PassThrough) => void,
                ) => {
                  onForward = callback;
                  return { port, dispose };
                },
              ),
            },
          }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createRemoteForward("session-1", 15401, "127.0.0.1", address.port);
    try {
      const channel = new PassThrough();
      channel.destroy = vi.fn(() => {
        throw new Error("remote channel destroy failed");
      }) as any;
      if (!onForward) throw new Error("Missing callback");
      onForward({}, () => channel);
      await vi.waitFor(() => expect(channel.listenerCount("close")).toBeGreaterThan(0));
      await expect(service.closeTunnel(tunnel.id)).rejects.toThrow("remote channel destroy failed");
      expect(service.listTunnels()).toHaveLength(1);
      expect(metrics.recordTunnelClosed).not.toHaveBeenCalled();
      channel.emit("close");
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  test("accepts close-before-throw as completed remote channel destruction", async () => {
    const target = net.createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    let onForward: ((details: unknown, accept: () => PassThrough) => void) | undefined;
    const dispose = vi.fn(async () => undefined);
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: vi.fn(
                async (
                  _host: string,
                  port: number,
                  callback: (details: unknown, accept: () => PassThrough) => void,
                ) => {
                  onForward = callback;
                  return { port, dispose };
                },
              ),
            },
          }) as any,
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const tunnel = await service.createRemoteForward("session-1", 15403, "127.0.0.1", address.port);
    try {
      const channel = new PassThrough();
      channel.destroy = vi.fn(() => {
        channel.emit("close");
        throw new Error("remote destroy threw after close");
      }) as any;
      if (!onForward) throw new Error("Missing remote callback");
      onForward({}, () => channel);
      await vi.waitFor(() => expect(channel.listenerCount("close")).toBeGreaterThan(0));
      await expect(service.closeTunnel(tunnel.id)).resolves.toBe(true);
      expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
      expect(service.listTunnels()).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  test("retains cancelled remote forwarding cleanup when first disposal fails", async () => {
    let finishForward:
      ((value: { port: number; dispose: () => Promise<void> }) => void) | undefined;
    let notifyClose: ((sessionId: string) => Promise<void> | void) | undefined;
    const dispose = vi
      .fn()
      .mockRejectedValueOnce(new Error("cancelled dispose failed"))
      .mockResolvedValue(undefined);
    const metrics = createTunnelMetrics();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: vi.fn(
                () =>
                  new Promise((resolve) => {
                    finishForward = resolve;
                  }),
              ),
            },
          }) as any,
        onSessionClose: (callback) => {
          notifyClose = callback;
        },
      },
      metrics,
      policy: createAllowPolicy(),
    });
    const creation = service.createRemoteForward("session-1", 15402, "127.0.0.1", 1234);
    if (!notifyClose || !finishForward) throw new Error("Missing creation hook");
    await notifyClose("session-1");
    finishForward({ port: 15402, dispose });
    await expect(creation).rejects.toThrow(/session|clos|dispose/i);
    expect(service.listTunnels("session-1")).toEqual([
      expect.objectContaining({ type: "remote", active: true }),
    ]);
    expect(metrics.recordTunnelClosed).not.toHaveBeenCalled();
    await expect(service.closeSessionTunnels("session-1")).resolves.toBe(1);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(service.listTunnels("session-1")).toEqual([]);
    expect(metrics.recordTunnelClosed).toHaveBeenCalledOnce();
  });

  test("handles default remotePort and forwardIn failure in createRemoteForward", async () => {
    const metrics = createTunnelMetrics();
    const policy = createAllowPolicy();
    const forwardIn = vi.fn(async (_host: string, _port: number) => {
      throw new Error("forward failed");
    });
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { forwardIn, forwardOut: vi.fn() },
          }) as any,
      },
      metrics,
      policy,
    });

    await expect(service.createRemoteForward("session-1", 9000, "localhost")).rejects.toThrow(
      "Remote tunnel forward failed on localhost:9000: forward failed",
    );
    expect(metrics.recordTunnelError).toHaveBeenCalled();
  });
});
