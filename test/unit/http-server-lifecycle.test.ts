import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createHttpServerLifecycle } from "../../src/http-server-lifecycle.js";

const servers = new Set<Server>();

function trackedServer(): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  servers.add(server);
  return server;
}

async function closeRawServer(server: Server): Promise<void> {
  servers.delete(server);
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for lifecycle condition");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...servers].map(closeRawServer));
});

describe("HTTP server lifecycle", () => {
  test("starts and closes once while repeated calls remain idempotent", async () => {
    const server = trackedServer();
    const beforeListen = vi.fn();
    const afterListen = vi.fn();
    const cleanup = vi.fn();
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: 0,
      beforeListen,
      afterListen,
      cleanup,
    });

    await Promise.all([lifecycle.start(), lifecycle.start()]);
    await lifecycle.start();
    const address = server.address() as AddressInfo;

    expect(address.port).toBeGreaterThan(0);
    expect(beforeListen).toHaveBeenCalledTimes(1);
    expect(afterListen).toHaveBeenCalledWith(address.port);

    await lifecycle.close("test-close");
    await lifecycle.close("test-close-again");
    servers.delete(server);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith("test-close");
    expect(server.listening).toBe(false);
    await expect(lifecycle.start()).rejects.toThrow("HTTP server lifecycle is closed");
  });

  test("does not bind if close wins while startup preparation is pending", async () => {
    const server = trackedServer();
    let releasePreparation: (() => void) | undefined;
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const cleanup = vi.fn();
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: 0,
      beforeListen: () => preparation,
      cleanup,
    });

    const startPromise = lifecycle.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await lifecycle.close("close-during-start");
    releasePreparation?.();

    await expect(startPromise).rejects.toThrow("HTTP server lifecycle is closed");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
  });

  test("cleans up when preparation fails before the server listens", async () => {
    const server = trackedServer();
    const cleanup = vi.fn();
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: 0,
      beforeListen: () => {
        throw new Error("preparation failed");
      },
      cleanup,
    });

    await expect(lifecycle.start()).rejects.toThrow("preparation failed");
    expect(cleanup).toHaveBeenCalledWith("startup-failed");
    expect(server.listening).toBe(false);
  });

  test("cleans up when the listen operation cannot bind", async () => {
    const occupied = trackedServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const occupiedPort = (occupied.address() as AddressInfo).port;
    const server = trackedServer();
    const cleanup = vi.fn();
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: occupiedPort,
      cleanup,
    });

    await expect(lifecycle.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(cleanup).toHaveBeenCalledWith("startup-failed");
    expect(server.listening).toBe(false);
  });

  test("handles process signals without exiting when configured for embedded use", async () => {
    const server = trackedServer();
    const cleanup = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: 0,
      registerSignalHandlers: true,
      exitOnSignal: false,
      cleanup,
    });

    await lifecycle.start();
    process.emit("SIGTERM", "SIGTERM");
    await waitFor(() => cleanup.mock.calls.length === 1 && !server.listening);
    servers.delete(server);

    expect(cleanup).toHaveBeenCalledWith("SIGTERM");
    expect(exit).not.toHaveBeenCalled();
  });

  test("closes the listener even when cleanup reports a failure", async () => {
    const server = trackedServer();
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: 0,
      cleanup: () => {
        throw new Error("cleanup failed");
      },
    });

    await lifecycle.start();
    await expect(lifecycle.close("failing-cleanup")).rejects.toThrow("cleanup failed");
    servers.delete(server);

    expect(server.listening).toBe(false);
  });

  test("can close an unstarted lifecycle without touching a socket", async () => {
    const server = trackedServer();
    const cleanup = vi.fn();
    const lifecycle = createHttpServerLifecycle({
      server,
      host: "127.0.0.1",
      port: 0,
      cleanup,
    });

    await lifecycle.close();

    expect(cleanup).toHaveBeenCalledWith("shutdown");
    expect(server.listening).toBe(false);
  });
});
