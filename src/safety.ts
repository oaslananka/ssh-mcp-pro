/**
 * Safety utilities for SSH command execution
 *
 * Provides warnings for potentially dangerous commands without blocking them.
 * Users are free to execute any command - this is just informational.
 */

import { logger } from "./logging.js";

/**
 * Command safety check result
 */
export interface SafetyCheckResult {
  safe: boolean;
  warning?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  suggestion?: string;
}

/**
 * Patterns for potentially dangerous commands
 */
const RECURSIVE_RM_OPTIONS = String.raw`(?=(?:[^\s]+\s+)*?(?:-[A-Za-z]*r[A-Za-z]*|--recursive))(?:-[A-Za-z]+|--[A-Za-z-]+)(?:\s+(?:-[A-Za-z]+|--[A-Za-z-]+))*`;
const SHELL_ARG = String.raw`(?:"[^"]*"|'[^']*'|\S+)`;
const SHELL_ARG_END = String.raw`(?:[\s;&|]|$)`;

function recursiveRmTargetPattern(targetPattern: string): RegExp {
  return new RegExp(
    String.raw`rm\s+${RECURSIVE_RM_OPTIONS}(?:\s+${SHELL_ARG})*\s+${targetPattern}${SHELL_ARG_END}`,
    "i",
  );
}

// Search the part of a command that a single-line regex wildcard would inspect.
function* commandTails(command: string, prefix: RegExp): Generator<string> {
  for (const match of command.matchAll(prefix)) {
    yield command.slice(match.index + match[0].length).split(/[\r\n]/u, 1)[0] ?? "";
  }
}

function writesToBlockDevice(command: string): boolean {
  const target = "of=/dev/";
  for (const tail of commandTails(command, /dd\s+/gi)) {
    const lowerTail = tail.toLowerCase();
    let offset = lowerTail.indexOf(target);
    while (offset >= 0) {
      const device = lowerTail.slice(offset + target.length);
      if (["sd", "hd", "nvme", "vd"].some((prefix) => device.startsWith(prefix))) {
        return true;
      }
      offset = lowerTail.indexOf(target, offset + target.length);
    }
  }
  return false;
}

function changesRootOwnership(command: string): boolean {
  const trimmed = command.trimEnd();
  if (!trimmed.endsWith("/")) {
    return false;
  }
  for (const match of command.matchAll(/chown\s+-R\s+/gi)) {
    const beforeRoot = trimmed.slice(match.index + match[0].length, -1);
    const trailingWhitespace = /\s/u.test(beforeRoot.at(-1) ?? "");
    const flagWhitespace = /\s+$/u.exec(match[0])?.[0].length ?? 0;
    if (
      (trailingWhitespace || (beforeRoot.length === 0 && flagWhitespace > 1)) &&
      !/[\r\n]/u.test(beforeRoot.trimEnd())
    ) {
      return true;
    }
  }
  return false;
}

function pipesRemoteScriptToShell(command: string, utility: "curl" | "wget"): boolean {
  const prefix = utility === "curl" ? /curl\s+/gi : /wget\s+/gi;
  for (const tail of commandTails(command, prefix)) {
    let pipe = tail.indexOf("|");
    while (pipe >= 0) {
      if (/^\s*(?:sudo\s+)?(?:bash|sh)/i.test(tail.slice(pipe + 1))) {
        return true;
      }
      pipe = tail.indexOf("|", pipe + 1);
    }
  }
  return false;
}

const DANGEROUS_PATTERNS: Array<{
  pattern: RegExp | ((command: string) => boolean);
  riskLevel: "low" | "medium" | "high" | "critical";
  warning: string;
  suggestion?: string;
}> = [
  // Critical: System destruction
  {
    pattern: recursiveRmTargetPattern(String.raw`(?:"/"|'/'|/)`),
    riskLevel: "critical",
    warning: "This command will delete the entire root filesystem!",
    suggestion: "Double-check the path before executing",
  },
  {
    pattern: recursiveRmTargetPattern(String.raw`(?:"/\*"|'/\*'|/\*)`),
    riskLevel: "critical",
    warning: "This command will delete all files in the root directory!",
    suggestion: "Double-check the path before executing",
  },
  {
    pattern: /mkfs\./i,
    riskLevel: "critical",
    warning: "This command will format a filesystem, causing data loss!",
    suggestion: "Verify the target device carefully",
  },
  {
    pattern: writesToBlockDevice,
    riskLevel: "critical",
    warning: "This command writes directly to a disk device!",
    suggestion: "Verify input and output devices before executing",
  },

  // High: System configuration changes
  {
    pattern: /chmod\s+(-R\s+)?777\s+\//i,
    riskLevel: "high",
    warning: "Setting 777 permissions on root is a security risk!",
    suggestion: "Use more restrictive permissions",
  },
  {
    pattern: changesRootOwnership,
    riskLevel: "high",
    warning: "Changing ownership of root directory recursively!",
    suggestion: "Verify the target path",
  },
  {
    pattern: /:\(\)\{\s*:\|:&\s*\};\s*:/i,
    riskLevel: "critical",
    warning: "Fork bomb detected! This will crash the system!",
    suggestion: "Do not execute this command",
  },
  {
    pattern: />\s*\/dev\/sd[a-z]$/i,
    riskLevel: "critical",
    warning: "Writing directly to disk device!",
    suggestion: "Verify the target device",
  },

  // Medium: Service disruption
  {
    pattern: /shutdown|reboot|init\s+[0-6]|poweroff/i,
    riskLevel: "medium",
    warning: "This command will shutdown or reboot the system",
    suggestion: "Ensure you have physical or out-of-band access",
  },
  {
    pattern: /systemctl\s+(stop|disable)\s+(sshd|ssh|networking|network)/i,
    riskLevel: "high",
    warning: "Stopping this service may disconnect your SSH session!",
    suggestion: "Have alternative access method ready",
  },
  {
    pattern: /iptables\s+-F/i,
    riskLevel: "medium",
    warning: "Flushing firewall rules may expose the system",
    suggestion: "Have a backup of current rules",
  },
  {
    pattern: /ufw\s+disable/i,
    riskLevel: "medium",
    warning: "Disabling firewall will expose all ports",
    suggestion: "Consider using specific allow rules instead",
  },

  // Low: Common mistakes
  {
    pattern: recursiveRmTargetPattern(String.raw`(?:"\."|'\.'|\.)`),
    riskLevel: "low",
    warning: "This will delete the current directory recursively",
    suggestion: "Verify you are in the correct directory",
  },
  {
    pattern: />\s*\/etc\/(passwd|shadow|sudoers)/i,
    riskLevel: "high",
    warning: "Overwriting critical system file!",
    suggestion: "Use proper editing tools like visudo",
  },
  {
    pattern: (command) => pipesRemoteScriptToShell(command, "curl"),
    riskLevel: "medium",
    warning: "Piping remote script directly to shell",
    suggestion: "Review the script before executing",
  },
  {
    pattern: (command) => pipesRemoteScriptToShell(command, "wget"),
    riskLevel: "medium",
    warning: "Piping remote script directly to shell",
    suggestion: "Review the script before executing",
  },
];

/**
 * Checks if a command is potentially dangerous
 * This NEVER blocks commands - only provides warnings
 */
export function checkCommandSafety(command: string): SafetyCheckResult {
  if (!command) {
    return { safe: true };
  }

  const normalizedCommand = command.trim();

  for (const { pattern, riskLevel, warning, suggestion } of DANGEROUS_PATTERNS) {
    if (
      typeof pattern === "function" ? pattern(normalizedCommand) : pattern.test(normalizedCommand)
    ) {
      logger.debug("Safety warning triggered", {
        command: normalizedCommand.substring(0, 50),
        riskLevel,
      });

      return {
        safe: false,
        warning,
        riskLevel,
        ...(suggestion ? { suggestion } : {}),
      };
    }
  }

  return { safe: true };
}

/**
 * Formats a safety warning for inclusion in command output
 */
export function formatSafetyWarning(result: SafetyCheckResult): string | undefined {
  if (result.safe) {
    return undefined;
  }

  const label = {
    low: "LOW",
    medium: "MEDIUM",
    high: "HIGH",
    critical: "CRITICAL",
  };

  let message = `[${label[result.riskLevel ?? "medium"]}] WARNING: ${result.warning}`;

  if (result.suggestion) {
    message += `\nSuggestion: ${result.suggestion}`;
  }

  return message;
}

/**
 * Enhances command result with safety warning if applicable
 */
export function addSafetyWarningToResult<T extends object>(
  command: string,
  result: T,
): T & { safetyWarning?: string } {
  const safetyCheck = checkCommandSafety(command);
  const warning = formatSafetyWarning(safetyCheck);

  if (warning) {
    return { ...result, safetyWarning: warning };
  }

  return result;
}
