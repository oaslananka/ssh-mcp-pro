import { describe, expect, jest, test } from "@jest/globals";
import { createTunnelService } from "../../src/tunnel.js";
import { createAllowPolicy, createSessionInfo, createTunnelMetrics } from "./helpers.js";

describe("createTunnelService", () => {
  test("creates, lists, and closes tunnels", async () => {
    const dispose = jest.fn(async () => undefined);
    const policy = createAllowPolicy();
    const service = createTunnelService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: {
              forwardIn: jest.fn(async (_host: string, port: number) => ({ port, dispose })),
              forwardOut: jest.fn(),
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
      forwardIn: jest.fn(),
      forwardOut: jest.fn(),
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
});
