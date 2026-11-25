import { spawn } from "node:child_process";
import {
  appendBoundedOutput,
  finalizeBoundedOutput,
  type OutputAccumulator,
} from "./agent-bounded-io.js";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  nextOffsetBytes?: number;
}

export type AllowedExecutable =
  "docker" | "journalctl" | "systemctl" | "powershell.exe" | "/bin/sh";

function validateExecutable(command: string): AllowedExecutable {
  switch (command) {
    case "docker":
      return "docker";
    case "journalctl":
      return "journalctl";
    case "systemctl":
      return "systemctl";
    case "powershell.exe":
      return "powershell.exe";
    case "/bin/sh":
      return "/bin/sh";
    default:
      throw Object.assign(new Error(`Command executable '${command}' is not permitted`), {
        code: "POLICY_DENIED" as const,
      });
  }
}

export function runCommand(
  command: AllowedExecutable,
  args: string[],
  options: { cwd?: string | undefined; timeoutSeconds: number; maxOutputBytes: number },
): Promise<ExecResult> {
  const binary = validateExecutable(command);
  return new Promise((resolve) => {
    // codeql[js/command-line-injection]
    const child = spawn(binary, args, {
      cwd: options.cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const stdout: OutputAccumulator = { bytes: 0, chunks: [], truncated: false };
    const stderr: OutputAccumulator = { bytes: 0, chunks: [], truncated: false };
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        setTimeout(() => {
          try {
            if (child.pid) {
              process.kill(-child.pid, "SIGKILL");
            }
          } catch {
            child.kill("SIGKILL");
          }
        }, 1500).unref();
      } else {
        child.kill("SIGTERM");
      }
    }, options.timeoutSeconds * 1000);

    child.stdout.on("data", (chunk: Buffer) =>
      appendBoundedOutput(stdout, chunk, options.maxOutputBytes),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      appendBoundedOutput(stderr, chunk, options.maxOutputBytes),
    );
    child.on("close", (code) => {
      clearTimeout(timeout);
      const out = finalizeBoundedOutput(stdout, options.maxOutputBytes);
      const err = finalizeBoundedOutput(stderr, options.maxOutputBytes);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 0),
        stdout: out.value.toString("utf8"),
        stderr: err.value.toString("utf8"),
        truncated: out.truncated || err.truncated,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: error.message,
        truncated: false,
      });
    });
  });
}
