import { describe, expect, test, vi } from "vitest";

type CheckResult = {
  status: "missing" | "reachable" | "unavailable";
  serverName: string;
  url: string;
};

type CheckPublishedRegistryRecord = (options: {
  fetchImpl: typeof fetch;
  logger: Pick<Console, "log" | "warn">;
  serverName?: string;
  timeoutMs?: number;
}) => Promise<CheckResult>;

async function loadChecker(): Promise<CheckPublishedRegistryRecord> {
  const scriptUrl = new URL("../../scripts/check-mcp-registry-record.mjs", import.meta.url);
  const module = (await import(scriptUrl.href)) as {
    checkPublishedRegistryRecord: CheckPublishedRegistryRecord;
  };

  return module.checkPublishedRegistryRecord;
}

describe("MCP Registry published record check", () => {
  test("treats missing registry records as non-blocking", async () => {
    const checkPublishedRegistryRecord = await loadChecker();
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    const result = await checkPublishedRegistryRecord({
      fetchImpl,
      logger,
      serverName: "io.github.oaslananka/ssh-mcp-pro",
    });

    expect(result.status).toBe("missing");
    expect(result.serverName).toBe("io.github.oaslananka/ssh-mcp-pro");
    expect(result.url).toContain("io.github.oaslananka%2Fssh-mcp-pro");
    expect(logger.log).toHaveBeenCalledWith(
      "No published registry record exists yet for io.github.oaslananka/ssh-mcp-pro.",
    );
  });

  test("uses the repo registry name by default", async () => {
    const checkPublishedRegistryRecord = await loadChecker();
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    const result = await checkPublishedRegistryRecord({
      fetchImpl,
      logger,
    });

    expect(result.serverName).toBe("io.github.oaslananka/ssh-mcp-pro");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.oaslananka%2Fssh-mcp-pro/versions/latest",
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
  });

  test("does not fail CI when the registry servers API times out", async () => {
    const checkPublishedRegistryRecord = await loadChecker();
    const timeoutError = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    const result = await checkPublishedRegistryRecord({
      fetchImpl,
      logger,
      serverName: "io.github.oaslananka/ssh-mcp-pro",
      timeoutMs: 1,
    });

    expect(result.status).toBe("unavailable");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "MCP Registry latest lookup unavailable for io.github.oaslananka/ssh-mcp-pro",
      ),
    );
  });

  test("fails when a reachable registry record resolves to a different server", async () => {
    const checkPublishedRegistryRecord = await loadChecker();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ server: { name: "io.github.someone-else/ssh-mcp-pro" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      checkPublishedRegistryRecord({
        fetchImpl,
        logger: console,
        serverName: "io.github.oaslananka/ssh-mcp-pro",
      }),
    ).rejects.toThrow(
      "Registry latest returned io.github.someone-else/ssh-mcp-pro, expected io.github.oaslananka/ssh-mcp-pro",
    );
  });
});
