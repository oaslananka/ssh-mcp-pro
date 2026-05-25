import { describe, expect, vi, test } from "vitest";
import { TunnelToolProvider } from "../../../src/tools/tunnel.provider.js";

describe("TunnelToolProvider", () => {
  test("dispatches tunnel tools", async () => {
    const listTunnels = vi.fn(() => [{ id: "t1" }]);
    const provider = new TunnelToolProvider({
      tunnelService: {
        createLocalForward: vi.fn(async () => ({ id: "t1" })),
        createRemoteForward: vi.fn(async () => ({ id: "t2" })),
        closeTunnel: vi.fn(async () => true),
        listTunnels,
      } as any,
    });

    await expect(
      provider.handleTool("tunnel_local_forward", {
        sessionId: "s",
        localPort: 8080,
        remotePort: 80,
      }),
    ).resolves.toEqual({ id: "t1" });
    await expect(
      provider.handleTool("tunnel_remote_forward", {
        sessionId: "s",
        remotePort: 8080,
        localPort: 80,
      }),
    ).resolves.toEqual({ id: "t2" });
    await expect(provider.handleTool("tunnel_close", { tunnelId: "t1" })).resolves.toEqual({
      closed: true,
    });
    await expect(provider.handleTool("tunnel_list", {})).resolves.toEqual({
      count: 1,
      tunnels: [{ id: "t1" }],
    });
    await expect(provider.handleTool("tunnel_list", { sessionId: "s" })).resolves.toEqual({
      count: 1,
      tunnels: [{ id: "t1" }],
    });
    expect((listTunnels as any).mock.calls.at(-1)).toEqual(["s"]);
    expect(provider.handleTool("missing", {})).toBeUndefined();
  });
});
