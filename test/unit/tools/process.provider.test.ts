import { describe, expect, jest, test } from "@jest/globals";
import { ProcessToolProvider } from "../../../src/tools/process.provider.js";

describe("ProcessToolProvider", () => {
  test("dispatches command tools", async () => {
    const provider = new ProcessToolProvider({
      processService: {
        execCommand: jest.fn(async () => ({
          code: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 5,
        })),
        execSudo: jest.fn(async () => ({
          code: 0,
          stdout: "sudo",
          stderr: "",
          durationMs: 5,
        })),
      } as any,
      streamingService: {
        execWithStreaming: jest.fn(async () => ({
          code: 0,
          chunks: [],
          stdout: "stream",
          stderr: "",
          durationMs: 5,
          truncated: false,
        })),
      },
      metrics: {
        recordCommand: jest.fn(),
      } as any,
    });

    await expect(
      provider.handleTool("proc_exec", {
        sessionId: "session-1",
        command: "echo ok",
      }),
    ).resolves.toEqual(expect.objectContaining({ stdout: "ok" }));
    await expect(
      provider.handleTool("proc_sudo", {
        sessionId: "session-1",
        command: "id",
      }),
    ).resolves.toEqual(expect.objectContaining({ stdout: "sudo" }));
    await expect(
      provider.handleTool("proc_exec_stream", {
        sessionId: "session-1",
        command: "tail -f",
      }),
    ).resolves.toEqual(expect.objectContaining({ stdout: "stream" }));
    expect(provider.handleTool("missing", {})).toBeUndefined();
  });

  test("passes optional process fields and records failed command outcomes", async () => {
    const execCommand = jest.fn(async () => ({
      code: 2,
      stdout: "",
      stderr: "denied",
      durationMs: 11,
    }));
    const execSudo = jest.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "sudo denied",
      durationMs: 12,
    }));
    const execWithStreaming = jest.fn(async () => ({
      code: 3,
      chunks: [{ stream: "stderr", data: "bad" }],
      stdout: "",
      stderr: "bad",
      durationMs: 13,
      truncated: true,
    }));
    const recordCommand = jest.fn();
    const provider = new ProcessToolProvider({
      processService: {
        execCommand,
        execSudo,
      } as any,
      streamingService: {
        execWithStreaming,
      } as any,
      metrics: {
        recordCommand,
      } as any,
    });

    await expect(
      provider.handleTool("proc_exec", {
        sessionId: "session-1",
        command: "rm -rf /tmp/demo",
        cwd: "/tmp",
        env: { PATH_SAFE: "/usr/bin" },
        timeoutMs: 2000,
      }),
    ).resolves.toEqual(expect.objectContaining({ code: 2 }));
    expect((execCommand as any).mock.calls[0]).toEqual([
      "session-1",
      "rm -rf /tmp/demo",
      "/tmp",
      { PATH_SAFE: "/usr/bin" },
      2000,
    ]);

    await expect(
      provider.handleTool("proc_sudo", {
        sessionId: "session-1",
        command: "id",
        cwd: "/root",
        timeoutMs: 3000,
      }),
    ).resolves.toEqual(expect.objectContaining({ code: 1 }));
    expect((execSudo as any).mock.calls[0]).toEqual(["session-1", "id", undefined, "/root", 3000]);

    await expect(
      provider.handleTool("proc_exec_stream", {
        sessionId: "session-1",
        command: "tail -f /var/log/app.log",
        cwd: "/var/log",
        env: { LC_ALL: "C" },
        timeoutMs: 4000,
      }),
    ).resolves.toEqual(expect.objectContaining({ code: 3, truncated: true }));
    expect((execWithStreaming as any).mock.calls[0]?.[0]).toEqual({
      sessionId: "session-1",
      command: "tail -f /var/log/app.log",
      cwd: "/var/log",
      env: { LC_ALL: "C" },
      timeoutMs: 4000,
    });
    expect(recordCommand).toHaveBeenNthCalledWith(1, 11, false);
    expect(recordCommand).toHaveBeenNthCalledWith(2, 12, false);
    expect(recordCommand).toHaveBeenNthCalledWith(3, 13, false);
  });
});
