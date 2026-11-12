import { spawn } from "node:child_process";
import { ManagedProcessRegistry } from "./agent-managed-process.js";
import { access } from "node:fs/promises";
import os from "node:os";
import {
  appendBoundedOutput,
  finalizeBoundedOutput,
  readFileBounded,
  readFilePageBounded,
  readFileTailBounded,
  type OutputAccumulator,
} from "./agent-bounded-io.js";
import { isContainerAllowed, isServiceAllowed } from "./policy.js";
import { searchAuthorizedFileNames, type FileSearchInput } from "./agent-file-search.js";
import { searchAuthorizedFileContents, type ContentSearchInput } from "./agent-content-search.js";
import {
  withAuthorizedRead,
  writeAuthorizedFileAtomic,
  replaceAuthorizedText,
} from "./safe-file.js";
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
  nextOffsetBytes?: number;
}

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.@:-]{1,128}$/u;

function scalarActionArgument(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw Object.assign(new Error("Action arguments must be scalar values"), {
    code: "POLICY_DENIED" as const,
  });
}

function requireByteCount(value: unknown, label: string, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw Object.assign(
      new Error(`${label} must be an integer between ${minimum} and ${maximum}`),
      {
        code: "POLICY_DENIED" as const,
      },
    );
  }
  return value;
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
  const escaped = value.replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw Object.assign(new Error(`${label} contains unsupported characters`), {
      code: "POLICY_DENIED" as const,
    });
  }
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

function managedResult(value: unknown): ExecResult {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "", truncated: false };
}

export class AgentExecutor {
  private readonly processes = new ManagedProcessRegistry();

  constructor(
    private policy: AgentPolicy,
    private readonly privateKeyPem: string,
  ) {}

  updatePolicy(policy: AgentPolicy): void {
    if (!policy.capabilities["shell.exec"]) this.processes.stopAll();
    this.policy = policy;
  }

  dispose(): void {
    this.processes.dispose();
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
        ...(result.nextOffsetBytes === undefined
          ? {}
          : { next_offset_bytes: result.nextOffsetBytes }),
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
        return this.tailLogs(scalarActionArgument(action.args.unit_or_file), timeoutSeconds);
      case "restart_service":
        return this.restartService(scalarActionArgument(action.args.service ?? ""), timeoutSeconds);
      case "docker_ps":
        return runCommand("docker", ["ps", "--format", "json"], {
          timeoutSeconds,
          maxOutputBytes: this.policy.maxOutputBytes,
        });
      case "docker_logs":
        return this.dockerLogs(
          scalarActionArgument(action.args.container ?? ""),
          Number(action.args.lines ?? 100),
          timeoutSeconds,
        );
      case "docker_restart":
        return this.dockerRestart(
          scalarActionArgument(action.args.container ?? ""),
          timeoutSeconds,
        );
      case "file_search":
        return this.fileSearch(action.args);
      case "file_content_search":
        return this.fileContentSearch(action.args);
      case "file_read": {
        const hasPaging =
          action.args.offset_bytes !== undefined || action.args.max_bytes !== undefined;
        const offsetBytes = hasPaging
          ? requireByteCount(action.args.offset_bytes ?? 0, "offset_bytes", 0, 2_147_483_647)
          : 0;
        const maxBytes = hasPaging
          ? requireByteCount(
              action.args.max_bytes ?? this.policy.maxOutputBytes,
              "max_bytes",
              4,
              1_048_576,
            )
          : this.policy.maxOutputBytes;
        return this.fileRead(
          scalarActionArgument(action.args.path ?? ""),
          hasPaging ? { offsetBytes, maxBytes } : undefined,
        );
      }
      case "file_replace":
        return this.fileReplace(action.args);
      case "file_write":
        return this.fileWrite(
          scalarActionArgument(action.args.path ?? ""),
          scalarActionArgument(action.args.content ?? ""),
        );
      case "process_start":
        return managedResult(
          await this.processes.start(
            action.user_id,
            action.agent_id,
            action.args,
            () => this.policy.capabilities["shell.exec"],
          ),
        );
      case "process_read":
        return managedResult(
          this.processes.read(action.user_id, action.agent_id, action.args, this.policy),
        );
      case "process_input":
        return managedResult(this.processes.input(action.user_id, action.agent_id, action.args));
      case "process_stop":
        return managedResult(this.processes.stop(action.user_id, action.agent_id, action.args));
      case "run_shell":
        return this.runShell(
          scalarActionArgument(action.args.command ?? ""),
          action.args.cwd ? scalarActionArgument(action.args.cwd) : undefined,
          timeoutSeconds,
        );
      case "run_shell_as_root":
        return this.runShellAsRoot(
          scalarActionArgument(action.args.command ?? ""),
          action.args.cwd ? scalarActionArgument(action.args.cwd) : undefined,
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
        : [
            "uname -a",
            String.raw`{ if command -v uptime >/dev/null 2>&1; then uptime; elif [ -r /proc/uptime ]; then read -r seconds _ < /proc/uptime && printf 'Uptime: %s seconds\n' "$seconds"; else printf 'Uptime unavailable\n' >&2; exit 1; fi; }`,
            "df -h /",
          ].join(" && ");
    // A non-login shell respects the caller's PATH and avoids unexpected /etc/profile side effects.
    const shell =
      process.platform === "win32"
        ? platformShell(command)
        : { command: "/bin/sh", args: ["-c", command] };
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
      const escapedTarget = target.replaceAll("'", "''");
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

  private async fileSearch(args: Record<string, unknown>): Promise<ExecResult> {
    const result = await searchAuthorizedFileNames(this.policy, args as unknown as FileSearchInput);
    return {
      exitCode: 0,
      stdout: JSON.stringify(result),
      stderr: "",
      truncated: result.truncated,
    };
  }

  private async fileContentSearch(args: Record<string, unknown>): Promise<ExecResult> {
    const result = await searchAuthorizedFileContents(
      this.policy,
      args as unknown as ContentSearchInput,
    );
    return { exitCode: 0, stdout: JSON.stringify(result), stderr: "", truncated: result.truncated };
  }

  private async fileRead(
    filePath: string,
    page?: { offsetBytes: number; maxBytes: number },
  ): Promise<ExecResult> {
    return withAuthorizedRead(
      this.policy,
      filePath,
      "Path is not allowed by local policy",
      "File read failed",
      async (file) => {
        const result = page
          ? await readFilePageBounded(
              file,
              page.offsetBytes,
              Math.min(page.maxBytes, this.policy.maxOutputBytes),
            )
          : await readFileBounded(file, this.policy.maxOutputBytes);
        return {
          exitCode: 0,
          stdout: result.value.toString("utf8"),
          stderr: "",
          truncated: result.truncated,
          ...("nextOffsetBytes" in result && typeof result.nextOffsetBytes === "number"
            ? { nextOffsetBytes: result.nextOffsetBytes }
            : {}),
        };
      },
    );
  }

  private async fileReplace(args: Record<string, unknown>): Promise<ExecResult> {
    if (!this.policy.capabilities["files.read"]) {
      throw Object.assign(new Error("file_replace also requires files.read"), {
        code: "CAPABILITY_DENIED" as const,
      });
    }
    const result = await replaceAuthorizedText(this.policy, {
      path: scalarActionArgument(args.path),
      oldText: scalarActionArgument(args.old_text),
      newText: scalarActionArgument(args.new_text),
      dryRun: args.dry_run === undefined ? true : args.dry_run,
      expectedSha256:
        args.expected_sha256 === undefined ? undefined : scalarActionArgument(args.expected_sha256),
    });
    return { exitCode: 0, stdout: JSON.stringify(result), stderr: "", truncated: false };
  }

  private async fileWrite(filePath: string, content: string): Promise<ExecResult> {
    await writeAuthorizedFileAtomic(
      this.policy,
      filePath,
      content,
      "Path is not allowed by local policy",
      "File write failed",
    );
    return { exitCode: 0, stdout: "written", stderr: "", truncated: false };
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
