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

  test("preserves agent runtime state across reconnect attempts", async () => {
    const receivedStates: unknown[] = [];
    let attempt = 0;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runAgentCliWithReconnect(
        ["run"],
        async (_args, state) => {
          receivedStates.push(state);
          attempt += 1;
          state?.seenActions?.set(`action-${attempt}`, Date.now() + 60_000);
          if (attempt === 1) {
            throw new RetryableAgentTransportError("Connection dropped");
          }
        },
        async () => {},
      );
    } finally {
      stderr.mockRestore();
    }
    expect(receivedStates.length).toBe(2);
    expect(receivedStates[0]).toBe(receivedStates[1]);
    const finalState = receivedStates[1] as { seenActions?: Map<string, number> };
    expect(finalState.seenActions?.has("action-1")).toBe(true);
    expect(finalState.seenActions?.has("action-2")).toBe(true);
  });
});
