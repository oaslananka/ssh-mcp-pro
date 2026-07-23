import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import { isContainerAllowed, isServiceAllowed } from "./policy.js";
import { withAuthorizedRead, withAuthorizedWrite } from "./safe-file.js";
import { TOOL_CAPABILITY_MAP } from "./types.js";
import type {
  ActionRequestEnvelope,
  ActionResultEnvelope,
  AgentPolicy,
  RemoteErrorCode,
} from "./types.js";
import { nowIso, randomToken, signEnvelope } from "./crypto.js";

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.@:-]{1,128}$/u;

interface OutputAccumulator {
  bytes: number;
  chunks: Buffer[];
  truncated: boolean;
}

function truncateBuffer(buffer: Buffer, maxBytes: number): { value: Buffer; truncated: boolean } {
  if (buffer.byteLength <= maxBytes) {
    return { value: buffer, truncated: false };
  }
  return appendTruncationMarker(buffer, maxBytes);
}

function platformShell(command: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    };
  }
  return { command: "/bin/sh", args: ["-lc", command] };
}

function powerShell(command: string, args: string[] = []): { command: string; args: string[] } {
  return {
    command: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command, ...args],
  };
}

function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function truncationMarker(maxBytes: number): Buffer {
  return Buffer.from(`\n[truncated after ${maxBytes} bytes]\n`);
}

function appendTruncationMarker(
  buffer: Buffer,
  maxBytes: number,
): {
  value: Buffer;
  truncated: boolean;
} {
  if (maxBytes <= 0) {
    return { value: Buffer.alloc(0), truncated: true };
  }
  const marker = truncationMarker(maxBytes);
  if (marker.byteLength >= maxBytes) {
    return { value: marker.subarray(0, maxBytes), truncated: true };
  }
  const payloadBytes = Math.max(0, maxBytes - marker.byteLength);
  return {
    value: Buffer.concat([buffer.subarray(0, payloadBytes), marker], maxBytes),
    truncated: true,
  };
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw Object.assign(new Error(`${label} contains unsupported characters`), {
      code: "POLICY_DENIED" as const,
    });
  }
}

function appendBoundedOutput(
  accumulator: OutputAccumulator,
  chunk: Buffer,
  maxBytes: number,
): void {
  if (maxBytes <= 0) {
    accumulator.truncated ||= chunk.byteLength > 0;
    return;
  }
  const remaining = maxBytes - accumulator.bytes;
  if (remaining <= 0) {
    accumulator.truncated = true;
    return;
  }
  const slice = chunk.subarray(0, remaining);
  accumulator.chunks.push(slice);
  accumulator.bytes += slice.byteLength;
  accumulator.truncated ||= slice.byteLength !== chunk.byteLength;
}

function finalizeBoundedOutput(
  accumulator: OutputAccumulator,
  maxBytes: number,
): { value: Buffer; truncated: boolean } {
  const value = Buffer.concat(accumulator.chunks, accumulator.bytes);
  if (!accumulator.truncated) {
    return { value, truncated: false };
  }
  return appendTruncationMarker(value, maxBytes);
}

async function readHandleRange(file: FileHandle, start: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.max(0, length));
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      start + offset,
    );
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

async function readFileBounded(
  file: FileHandle,
  maxBytes: number,
): Promise<{
  value: Buffer;
  truncated: boolean;
}> {
  const cappedBytes = Math.max(0, maxBytes);
  const buffer = await readHandleRange(file, 0, cappedBytes + 1);
  return truncateBuffer(buffer, cappedBytes);
}

const TAIL_SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_TAIL_SCAN_BYTES = 8 * 1024 * 1024;

interface TailStart {
  offset: number;
  scanTruncated: boolean;
}

async function findTailStart(
  file: FileHandle,
  size: number,
  maxLines: number,
  maxScanBytes: number,
): Promise<TailStart> {
  if (size <= 0 || maxLines <= 0) {
    return { offset: size, scanTruncated: false };
  }

  let position = size;
  const minimumPosition = Math.max(0, size - Math.max(0, maxScanBytes));
  let includedLines = 1;
  while (position > minimumPosition) {
    const chunkSize = Math.min(TAIL_SCAN_CHUNK_BYTES, position - minimumPosition);
    position -= chunkSize;
    const chunk = await readHandleRange(file, position, chunkSize);
    for (let index = chunk.byteLength - 1; index >= 0; index -= 1) {
      const absoluteIndex = position + index;
      if (chunk[index] !== 0x0a || absoluteIndex === size - 1) {
        continue;
      }
      if (includedLines >= maxLines) {
        return { offset: absoluteIndex + 1, scanTruncated: false };
      }
      includedLines += 1;
    }
  }
  return { offset: minimumPosition, scanTruncated: minimumPosition > 0 };
}

async function readFileTailBounded(
  file: FileHandle,
  maxBytes: number,
  maxLines = 100,
): Promise<{
  value: Buffer;
  truncated: boolean;
}> {
  const cappedBytes = Math.max(0, maxBytes);
  const stats = await file.stat();
  const scanBytes = Math.max(
    TAIL_SCAN_CHUNK_BYTES,
    Math.min(MAX_TAIL_SCAN_BYTES, cappedBytes * 4 + 1),
  );
  const { offset, scanTruncated } = await findTailStart(file, stats.size, maxLines, scanBytes);
  const bytesToRead = Math.min(stats.size - offset, cappedBytes + 1);
  const buffer = await readHandleRange(file, offset, bytesToRead);
  const bounded = truncateBuffer(buffer, cappedBytes);
  return scanTruncated && !bounded.truncated
    ? appendTruncationMarker(bounded.value, cappedBytes)
    : bounded;
}

function isLogFileTarget(target: string): boolean {
  return target.includes("/") || target.includes("\\") || /^[A-Za-z]:[\\/]/u.test(target);
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string | undefined; timeoutSeconds: number; maxOutputBytes: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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

export class AgentExecutor {
  constructor(
    private policy: AgentPolicy,
    private readonly privateKeyPem: string,
  ) {}

  updatePolicy(policy: AgentPolicy): void {
    this.policy = policy;
  }

  async execute(action: ActionRequestEnvelope): Promise<ActionResultEnvelope> {
    const startedAt = nowIso();
    try {
      const result = await this.executeAllowed(action);
      return this.signResult({
        type: "action.result",
        action_id: action.action_id,
        agent_id: action.agent_id,
        nonce: randomToken(16),
        status: "ok",
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        started_at: startedAt,
        finished_at: nowIso(),
        truncated: result.truncated,
        signature: "",
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: RemoteErrorCode }).code
          : "INTERNAL_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      return this.signResult({
        type: "action.result",
        action_id: action.action_id,
        agent_id: action.agent_id,
        nonce: randomToken(16),
        status: "error",
        started_at: startedAt,
        finished_at: nowIso(),
        truncated: false,
        error_code: code,
        message,
        signature: "",
      });
    }
  }

  private async executeAllowed(action: ActionRequestEnvelope): Promise<ExecResult> {
    const requiredCapability = TOOL_CAPABILITY_MAP[action.tool];
    if (!requiredCapability) {
      throw Object.assign(new Error(`Unsupported action ${action.tool}`), {
        code: "UNSUPPORTED_PLATFORM" as const,
      });
    }
    if (action.capability !== requiredCapability) {
      throw Object.assign(
        new Error(
          `Tool ${action.tool} requires ${requiredCapability}, received ${action.capability}`,
        ),
        { code: "CAPABILITY_DENIED" as const },
      );
    }
    if (!this.policy.capabilities[requiredCapability]) {
      throw Object.assign(new Error(`Capability ${requiredCapability} is not enabled`), {
        code: "CAPABILITY_DENIED" as const,
      });
    }
    const timeoutSeconds = Math.min(
      Number(action.args.timeout_seconds ?? this.policy.maxActionTimeoutSeconds),
      this.policy.maxActionTimeoutSeconds,
    );

    switch (action.tool) {
      case "get_system_status":
        return this.getSystemStatus(timeoutSeconds);
      case "tail_logs":
        return this.tailLogs(String(action.args.unit_or_file ?? ""), timeoutSeconds);
      case "restart_service":
        return this.restartService(String(action.args.service ?? ""), timeoutSeconds);
      case "docker_ps":
        return runCommand("docker", ["ps", "--format", "json"], {
          timeoutSeconds,
          maxOutputBytes: this.policy.maxOutputBytes,
        });
      case "docker_logs":
        return this.dockerLogs(
          String(action.args.container ?? ""),
          Number(action.args.lines ?? 100),
          timeoutSeconds,
        );
      case "docker_restart":
        return this.dockerRestart(String(action.args.container ?? ""), timeoutSeconds);
      case "file_read":
        return this.fileRead(String(action.args.path ?? ""));
      case "file_write":
        return this.fileWrite(String(action.args.path ?? ""), String(action.args.content ?? ""));
      case "run_shell":
        return this.runShell(
          String(action.args.command ?? ""),
          action.args.cwd ? String(action.args.cwd) : undefined,
          timeoutSeconds,
        );
      case "run_shell_as_root":
        return this.runShellAsRoot(
          String(action.args.command ?? ""),
          action.args.cwd ? String(action.args.cwd) : undefined,
          timeoutSeconds,
        );
      default:
        throw Object.assign(new Error(`Unsupported action ${action.tool}`), {
          code: "UNSUPPORTED_PLATFORM" as const,
        });
    }
  }

  private getSystemStatus(timeoutSeconds: number): Promise<ExecResult> {
    const command =
      process.platform === "win32"
        ? "Get-ComputerInfo | Select-Object CsName,OsName,OsVersion,CsTotalPhysicalMemory | ConvertTo-Json -Compress"
        : "uname -a && uptime && df -h /";
    const shell = platformShell(command);
    return runCommand(shell.command, shell.args, {
      timeoutSeconds,
      maxOutputBytes: this.policy.maxOutputBytes,
    });
  }

  private async tailLogs(target: string, timeoutSeconds: number): Promise<ExecResult> {
    if (!target) {
      throw Object.assign(new Error("unit_or_file is required"), {
        code: "POLICY_DENIED" as const,
      });
    }
    const isFileTarget = isLogFileTarget(target);
    if (isFileTarget) {
      return withAuthorizedRead(
        this.policy,
        target,
        "Log path is not allowed by local policy",
        "Log operation failed",
        async (file) => {
          const truncated = await readFileTailBounded(file, this.policy.maxOutputBytes);
          return {
            exitCode: 0,
            stdout: truncated.value.toString("utf8"),
            stderr: "",
            truncated: truncated.truncated,
          };
        },
      );
    }
    if (process.platform === "win32") {
      assertSafeIdentifier(target, "Log target");
      const escapedTarget = target.replace(/'/gu, "''");
      return runCommand(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-EventLog -LogName '${escapedTarget}' -Newest 100 | ConvertTo-Json -Compress`,
        ],
        {
          timeoutSeconds,
          maxOutputBytes: this.policy.maxOutputBytes,
        },
      );
    }
    assertSafeIdentifier(target, "Systemd unit");
    return runCommand("journalctl", ["-u", target, "-n", "100", "--no-pager"], {
      timeoutSeconds,
      maxOutputBytes: this.policy.maxOutputBytes,
    });
  }

  private restartService(service: string, timeoutSeconds: number): Promise<ExecResult> {
    if (!service || !isServiceAllowed(this.policy, service)) {
      throw Object.assign(new Error("Service is not allowed by local policy"), {
        code: "POLICY_DENIED" as const,
      });
    }
    assertSafeIdentifier(service, "Service name");
    const shell =
      process.platform === "win32"
        ? powerShell("Restart-Service -Name $args[0]", [service])
        : { command: "systemctl", args: ["restart", service] };
    return runCommand(shell.command, shell.args, {
      timeoutSeconds,
      maxOutputBytes: this.policy.maxOutputBytes,
    });
  }

  private dockerLogs(
    container: string,
    lines: number,
    timeoutSeconds: number,
  ): Promise<ExecResult> {
    if (!container || !isContainerAllowed(this.policy, container)) {
      throw Object.assign(new Error("Container is not allowed by local policy"), {
        code: "POLICY_DENIED" as const,
      });
    }
    assertSafeIdentifier(container, "Container name");
    return runCommand("docker", ["logs", "--tail", String(Math.min(lines, 500)), container], {
      timeoutSeconds,
      maxOutputBytes: this.policy.maxOutputBytes,
    });
  }

  private dockerRestart(container: string, timeoutSeconds: number): Promise<ExecResult> {
    if (!container || !isContainerAllowed(this.policy, container)) {
      throw Object.assign(new Error("Container is not allowed by local policy"), {
        code: "POLICY_DENIED" as const,
      });
    }
    assertSafeIdentifier(container, "Container name");
    return runCommand("docker", ["restart", container], {
      timeoutSeconds,
      maxOutputBytes: this.policy.maxOutputBytes,
    });
  }

  private async fileRead(filePath: string): Promise<ExecResult> {
    return withAuthorizedRead(
      this.policy,
      filePath,
      "Path is not allowed by local policy",
      "File read failed",
      async (file) => {
        const truncated = await readFileBounded(file, this.policy.maxOutputBytes);
        return {
          exitCode: 0,
          stdout: truncated.value.toString("utf8"),
          stderr: "",
          truncated: truncated.truncated,
        };
      },
    );
  }

  private async fileWrite(filePath: string, content: string): Promise<ExecResult> {
    return withAuthorizedWrite(
      this.policy,
      filePath,
      "Path is not allowed by local policy",
      "File write failed",
      async (file) => {
        await file.truncate(0);
        await file.writeFile(content, { encoding: "utf8" });
        return { exitCode: 0, stdout: "written", stderr: "", truncated: false };
      },
    );
  }

  private async runShell(
    command: string,
    cwd: string | undefined,
    timeoutSeconds: number,
  ): Promise<ExecResult> {
    if (cwd) {
      await access(cwd);
    }
    const shell = platformShell(command);
    return runCommand(shell.command, shell.args, {
      cwd,
      timeoutSeconds,
      maxOutputBytes: this.policy.maxOutputBytes,
    });
  }

  private runShellAsRoot(
    command: string,
    cwd: string | undefined,
    timeoutSeconds: number,
  ): Promise<ExecResult> {
    if (process.platform === "win32") {
      throw Object.assign(new Error("Root execution requires an elevated Windows agent service"), {
        code: "UNSUPPORTED_PLATFORM_OR_PRIVILEGE" as const,
      });
    }
    if (typeof process.getuid === "function" && process.getuid() !== 0) {
      const shell = platformShell(`sudo -n /bin/sh -lc ${posixSingleQuote(command)}`);
      return runCommand(shell.command, shell.args, {
        cwd,
        timeoutSeconds,
        maxOutputBytes: this.policy.maxOutputBytes,
      });
    }
    return this.runShell(command, cwd, timeoutSeconds);
  }

  private signResult(result: ActionResultEnvelope): ActionResultEnvelope {
    return {
      ...result,
      signature: signEnvelope(result as unknown as Record<string, unknown>, this.privateKeyPem),
    };
  }
}

export function defaultHostMetadata() {
  return {
    hostname: os.hostname(),
    os: os.type(),
    arch: os.arch(),
    platform: process.platform,
  };
}
