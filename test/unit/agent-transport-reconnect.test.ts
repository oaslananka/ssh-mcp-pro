import { describe, expect, test, vi } from "vitest";
import {
  RetryableAgentTransportError,
  runAgentCliWithReconnect,
} from "../../src/remote/agent-cli.js";

describe("outbound agent reconnection", () => {
  test("recovers from repeated transport disconnects with bounded backoff", async () => {
    const attempts: string[][] = [];
    const delays: number[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runAgentCliWithReconnect(
        ["run"],
        async (args) => {
          attempts.push([...args]);
          if (attempts.length <= 8) {
            throw new RetryableAgentTransportError("Agent WebSocket connection closed");
          }
        },
        async (delayMs) => {
          delays.push(delayMs);
        },
      );
    } finally {
      stderr.mockRestore();
    }
    expect(attempts).toEqual(Array.from({ length: 9 }, () => ["run"]));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  test("does not retry non-transport failures", async () => {
    let attempts = 0;
    await expect(
      runAgentCliWithReconnect(
        ["run"],
        async () => {
          attempts += 1;
          throw new Error("Agent identity rejected");
        },
        async () => {
          throw new Error("Unexpected retry");
        },
      ),
    ).rejects.toThrow("Agent identity rejected");
    expect(attempts).toBe(1);
  });

  test("does not alter one-shot CLI commands", async () => {
    const commands: string[] = [];
    await runAgentCliWithReconnect(
      ["status"],
      async ([name]) => {
        commands.push(name ?? "");
      },
      async () => {
        throw new Error("Unexpected retry");
      },
    );
    expect(commands).toEqual(["status"]);
  });
});
