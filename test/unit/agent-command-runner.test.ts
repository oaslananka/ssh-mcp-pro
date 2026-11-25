import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runCommand } from "../../src/remote/agent-command-runner.js";

const options = { timeoutSeconds: 10, maxOutputBytes: 64 };

function runLocal(script: string, overrides: Partial<typeof options & { cwd: string }> = {}) {
  return process.platform === "win32"
    ? runCommand(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { ...options, ...overrides },
      )
    : runCommand("/bin/sh", ["-lc", script], { ...options, ...overrides });
}

describe("bounded agent command runner", () => {
  test("preserves exit status and captures stdout and stderr separately", async () => {
    const result = await runLocal(
      process.platform === "win32"
        ? "[Console]::Out.Write('out'); [Console]::Error.Write('err'); exit 7"
        : "printf out; printf err >&2; exit 7",
    );
    expect(result).toEqual({ exitCode: 7, stdout: "out", stderr: "err", truncated: false });
  });

  test("bounds both streams and reports truncation", async () => {
    const result = await runLocal(
      process.platform === "win32"
        ? "[Console]::Out.Write('x' * 200); [Console]::Error.Write('y' * 200)"
        : "printf '%0200d' 0; printf '%0200d' 0 >&2",
    );
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(64);
    expect(result.stdout).toContain("truncated");
    expect(result.stderr).toContain("truncated");
  });

  test("reports an unavailable working directory without starting a process", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agent-command-runner-"));
    try {
      const result = await runLocal("exit 0", { cwd: path.join(dir, "missing") });
      expect(result).toMatchObject({ exitCode: 127, stdout: "", truncated: false });
      expect(result.stderr).not.toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("retains the executable allowlist at runtime", () => {
    expect(() => runCommand("unlisted" as Parameters<typeof runCommand>[0], [], options)).toThrow(
      expect.objectContaining({ code: "POLICY_DENIED" }),
    );
  });
});
