import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { resolveConnectorCredentials } from "../../src/connector-credentials.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

afterEach(() => {
  spawnMock.mockReset();
});

function fakeHelperWithStreamError(streamName: "stdin" | "stdout" | "stderr") {
  const emitter = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), { end: () => {} });
  const stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
  const stderr = Object.assign(new EventEmitter(), { resume: () => {} });
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    kill: (_signal: string) => {
      queueMicrotask(() => emitter.emit("close", null));
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;
  stdin.end = () => {
    queueMicrotask(() => child[streamName].emit("error", new Error("synthetic EPIPE")));
  };
  return child;
}

describe("credential helper stream error containment", () => {
  test.each(["stdin", "stdout", "stderr"] as const)(
    "handles an %s stream error without crashing the server",
    async (streamName) => {
      spawnMock.mockReturnValue(fakeHelperWithStreamError(streamName));
      await expect(
        resolveConnectorCredentials(
          { hostAlias: "synthetic-host", purpose: "inspect" },
          {
            ...DEFAULT_CONFIG,
            connector: {
              ...DEFAULT_CONFIG.connector,
              credentialProvider: "command",
              credentialCommand: "synthetic-helper",
              defaultUsername: "deploy",
            },
          },
        ),
      ).rejects.toThrow("stream failed");
      expect(spawnMock).toHaveBeenCalledTimes(1);
    },
  );
});
