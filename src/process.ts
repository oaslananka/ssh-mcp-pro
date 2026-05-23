import { createSudoError, wrapError, createTimeoutError } from "./errors.js";
import { logger, createTimer } from "./logging.js";
import type { PolicyAction, PolicyEngine } from "./policy.js";
import type { SessionManager } from "./session.js";
import { buildRemoteCommandWithTimeout, buildSudoCommand } from "./shell.js";
import type { ServerConfig } from "./config.js";
import type { ExecResult } from "./types.js";
import { ErrorCode } from "./types.js";

export interface ProcessService {
  execCommand(
    sessionId: string,
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeoutMs?: number,
  ): Promise<ExecResult>;
  execSudo(
    sessionId: string,
    command: string,
    password?: string,
    cwd?: string,
    timeoutMs?: number,
    policyOptions?: SudoPolicyOptions,
  ): Promise<ExecResult>;
  commandExists(sessionId: string, command: string): Promise<boolean>;
  getAvailableShell(sessionId: string): Promise<string>;
  execWithShell(
    sessionId: string,
    command: string,
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<ExecResult>;
}

export interface SudoPolicyOptions {
  policyAction?: PolicyAction;
  rawSudo?: boolean;
  path?: string;
  destructive?: boolean;
}

export interface ProcessServiceDeps {
  sessionManager: Pick<SessionManager, "getSession" | "getOSInfo">;
  config: Pick<ServerConfig, "commandTimeoutMs" | "maxCommandOutputBytes">;
  policy: Pick<PolicyEngine, "assertAllowed">;
}

function truncateText(value: string, maxBytes: number): string {
  const valueBytes = Buffer.byteLength(value, "utf8");
  if (valueBytes <= maxBytes) {
    return value;
  }

  const marker = `\n[ssh-mcp-pro: output truncated after ${maxBytes} bytes]\n`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const budget = Math.max(0, maxBytes - markerBytes);
  let output = "";
  let used = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (used + charBytes > budget) {
      break;
    }
    output += char;
    used += charBytes;
  }
  return `${output}${marker}`;
}

async function execWithTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            createTimeoutError(
              `${label} timed out after ${timeoutMs}ms`,
              "Increase timeout or optimize the command",
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createProcessService({
  sessionManager,
  config,
  policy,
}: ProcessServiceDeps): ProcessService {
  async function execCommand(
    sessionId: string,
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeoutMs?: number,
  ): Promise<ExecResult> {
    logger.debug("Executing command", { sessionId, command, cwd, timeoutMs });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    const decision = policy.assertAllowed({
      action: "proc.exec",
      command,
      mode: session.info.policyMode,
    });

    if (decision.mode === "explain") {
      return {
        code: 0,
        stdout: JSON.stringify({ wouldExecute: true, command, policy: decision }, null, 2),
        stderr: "",
        durationMs: 0,
      };
    }

    const osInfo = await sessionManager.getOSInfo(sessionId);
    const timer = createTimer();
    const effectiveTimeoutMs = timeoutMs ?? config.commandTimeoutMs;

    try {
      const shellCommand = buildRemoteCommandWithTimeout(
        command,
        osInfo,
        effectiveTimeoutMs,
        cwd,
        env,
      );

      const result = await execWithTimeout(
        session.ssh.execCommand(shellCommand),
        effectiveTimeoutMs,
        "Command",
      );

      const execResult: ExecResult = {
        code: result.code ?? 0,
        stdout: truncateText(result.stdout ?? "", config.maxCommandOutputBytes),
        stderr: truncateText(result.stderr ?? "", config.maxCommandOutputBytes),
        durationMs: timer.elapsed(),
      };

      if (execResult.code === 124 || execResult.code === 137 || execResult.code === 143) {
        throw createTimeoutError(
          `Command timed out after ${effectiveTimeoutMs}ms and remote termination was requested`,
          "Increase timeout or optimize the command",
        );
      }

      logger.debug("Command execution completed", {
        sessionId,
        code: execResult.code,
        durationMs: execResult.durationMs,
      });

      return execResult;
    } catch (error) {
      logger.error("Command execution failed", { sessionId, command, error });
      if ((error as { code?: ErrorCode } | undefined)?.code === ErrorCode.ETIMEOUT) {
        throw error;
      }
      throw wrapError(error, ErrorCode.ECONN, "Failed to execute command on remote system");
    }
  }

  async function execSudo(
    sessionId: string,
    command: string,
    password?: string,
    cwd?: string,
    timeoutMs?: number,
    policyOptions: SudoPolicyOptions = {},
  ): Promise<ExecResult> {
    logger.debug("Executing sudo command", {
      sessionId,
      command,
      cwd,
      timeoutMs,
    });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    const decision = policy.assertAllowed({
      action: policyOptions.policyAction ?? "proc.sudo",
      command,
      mode: session.info.policyMode,
      rawSudo: policyOptions.rawSudo ?? true,
      ...(policyOptions.path ? { path: policyOptions.path } : {}),
      ...(policyOptions.destructive !== undefined
        ? { destructive: policyOptions.destructive }
        : {}),
    });

    if (decision.mode === "explain") {
      return {
        code: 0,
        stdout: JSON.stringify(
          { wouldExecute: true, command, sudo: true, policy: decision },
          null,
          2,
        ),
        stderr: "",
        durationMs: 0,
      };
    }

    const osInfo = await sessionManager.getOSInfo(sessionId);
    if (osInfo.platform === "windows") {
      throw createSudoError(
        "Sudo is not supported on Windows hosts",
        "Use an elevated session instead of sudo commands",
      );
    }

    const timer = createTimer();
    const effectiveTimeoutMs = timeoutMs ?? config.commandTimeoutMs;

    try {
      if (password !== undefined) {
        throw createSudoError(
          "Password-based sudo through MCP inputs is disabled",
          "Configure a restricted NOPASSWD sudoers allowlist for approved commands.",
        );
      }

      const fullCommand = buildSudoCommand(command, osInfo, cwd);
      const result = await execWithTimeout(
        session.ssh.execCommand(fullCommand),
        effectiveTimeoutMs,
        "Sudo command",
      );

      if ((result.code ?? 0) !== 0 && result.stderr) {
        const stderrLower = result.stderr.toLowerCase();
        if (
          stderrLower.includes("password") ||
          stderrLower.includes("authentication") ||
          stderrLower.includes("sorry")
        ) {
          throw createSudoError(
            "Sudo authentication failed",
            "Configure a restricted NOPASSWD sudoers profile for approved commands.",
          );
        }
      }

      const execResult: ExecResult = {
        code: result.code ?? 0,
        stdout: truncateText(result.stdout ?? "", config.maxCommandOutputBytes),
        stderr: truncateText(result.stderr ?? "", config.maxCommandOutputBytes),
        durationMs: timer.elapsed(),
      };

      logger.debug("Sudo command execution completed", {
        sessionId,
        code: execResult.code,
        durationMs: execResult.durationMs,
      });

      return execResult;
    } catch (error) {
      if ((error as { code?: ErrorCode } | undefined)?.code === ErrorCode.ETIMEOUT) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("sudo")) {
        throw error;
      }

      logger.error("Sudo command execution failed", {
        sessionId,
        command,
        error,
      });
      throw wrapError(error, ErrorCode.ENOSUDO, "Failed to execute sudo command on remote system");
    }
  }

  async function commandExists(sessionId: string, command: string): Promise<boolean> {
    try {
      const result = await execCommand(sessionId, `which ${command}`);
      return result.code === 0;
    } catch {
      return false;
    }
  }

  async function getAvailableShell(sessionId: string): Promise<string> {
    const shells = ["bash", "zsh", "sh"];

    for (const shell of shells) {
      if (await commandExists(sessionId, shell)) {
        logger.debug("Found available shell", { sessionId, shell });
        return shell;
      }
    }

    logger.warn("No standard shell found, defaulting to sh", { sessionId });
    return "sh";
  }

  async function execWithShell(
    sessionId: string,
    command: string,
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<ExecResult> {
    const shell = await getAvailableShell(sessionId);
    let fullCommand = command;

    if (env && Object.keys(env).length > 0) {
      const envVars = Object.entries(env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ");
      fullCommand = `${envVars} ${command}`;
    }

    if (cwd) {
      fullCommand = `cd ${JSON.stringify(cwd)} && ${fullCommand}`;
    }

    return execCommand(sessionId, `${shell} -lc ${JSON.stringify(fullCommand)}`);
  }

  return {
    execCommand,
    execSudo,
    commandExists,
    getAvailableShell,
    execWithShell,
  };
}
