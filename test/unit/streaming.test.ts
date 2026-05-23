import { describe, expect, jest, test } from "@jest/globals";
import { createStreamingService, formatStreamOutput } from "../../src/streaming.js";
import { createAllowPolicy, createSessionInfo, createTestConfig } from "./helpers.js";

describe("createStreamingService", () => {
  test("streams stdout and stderr chunks", async () => {
    const execCommand = jest.fn(
      async (
        _command: string,
        options?: { onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void },
      ) => {
        options?.onStdout?.(Buffer.from("hello"));
        options?.onStderr?.(Buffer.from("warn"));
        return { code: 0 };
      },
    );
    const service = createStreamingService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => ({
          platform: "linux",
          distro: "ubuntu",
          version: "22.04",
          arch: "x64",
          shell: "bash",
          packageManager: "apt",
          init: "systemd",
          defaultShell: "bash",
        }),
      },
      config: createTestConfig(),
      policy: createAllowPolicy(),
    });
    const onChunk = jest.fn();

    const result = await service.execWithStreaming({
      sessionId: "session-1",
      command: "echo hello",
      onChunk,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("warn");
    expect(result.truncated).toBe(false);
    expect(result.chunks.at(-1)?.type).toBe("exit");
    expect(onChunk).toHaveBeenCalled();
  });

  test("bounds retained chunks and buffered output", async () => {
    const execCommand = jest.fn(
      async (
        _command: string,
        options?: { onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void },
      ) => {
        options?.onStdout?.(Buffer.from("abcdef"));
        options?.onStderr?.(Buffer.from("ghijkl"));
        return { code: 0 };
      },
    );
    const service = createStreamingService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => ({
          platform: "linux",
          distro: "ubuntu",
          version: "22.04",
          arch: "x64",
          shell: "bash",
          packageManager: "apt",
          init: "systemd",
          defaultShell: "bash",
        }),
      },
      config: { ...createTestConfig(), maxCommandOutputBytes: 3, maxStreamChunks: 1 },
      policy: createAllowPolicy(),
    });

    const result = await service.execWithStreaming({
      sessionId: "session-1",
      command: "cat large",
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe("abc");
    expect(result.stderr).toBe("ghi");
    expect(result.chunks.some((chunk) => chunk.type === "truncated")).toBe(true);
  });

  test("throws when session is missing", async () => {
    const service = createStreamingService({
      sessionManager: {
        getSession: () => undefined,
        getOSInfo: async () => {
          throw new Error("unreachable");
        },
      },
      config: createTestConfig(),
      policy: createAllowPolicy(),
    });

    await expect(
      service.execWithStreaming({
        sessionId: "missing",
        command: "echo hi",
      }),
    ).rejects.toThrow("Session missing not found or expired");
  });

  test("formatStreamOutput concatenates non-exit chunks", () => {
    expect(
      formatStreamOutput([
        { type: "stdout", data: "a", timestamp: 1 },
        { type: "stderr", data: "b", timestamp: 2 },
        { type: "truncated", data: "x", timestamp: 3 },
        { type: "exit", code: 0, timestamp: 4 },
      ]),
    ).toBe("ab");
  });
});
