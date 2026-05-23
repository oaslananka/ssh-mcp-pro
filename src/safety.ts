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

const DANGEROUS_PATTERNS: Array<{
  pattern: RegExp;
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
    pattern: /dd\s+.*of=\/dev\/(sd|hd|nvme|vd)/i,
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
    pattern: /chown\s+-R\s+.*\s+\/\s*$/i,
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
    pattern: /curl\s+.*\|\s*(sudo\s+)?(bash|sh)/i,
    riskLevel: "medium",
    warning: "Piping remote script directly to shell",
    suggestion: "Review the script before executing",
  },
  {
    pattern: /wget\s+.*\|\s*(sudo\s+)?(bash|sh)/i,
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
    if (pattern.test(normalizedCommand)) {
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
