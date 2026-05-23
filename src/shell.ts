import { OSInfo } from "./types.js";

export const POSIX_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function assertValidEnvironment(env?: Record<string, string>): void {
  for (const key of Object.keys(env ?? {})) {
    if (!POSIX_ENV_KEY_PATTERN.test(key)) {
      throw new Error(
        `Invalid environment variable name: ${key || "<empty>"}. Expected ${POSIX_ENV_KEY_PATTERN.source}`,
      );
    }
  }
}

export function buildPosixCommand(
  command: string,
  cwd?: string,
  env?: Record<string, string>,
  shellName: "sh" | "bash" = "sh",
): string {
  assertValidEnvironment(env);
  let fullCommand = command;

  if (env && Object.keys(env).length > 0) {
    const envVars = Object.entries(env)
      .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
      .join("; ");
    fullCommand = `${envVars}; ${fullCommand}`;
  }

  if (cwd) {
    fullCommand = `cd ${shellQuote(cwd)} && ${fullCommand}`;
  }

  return `${shellName} -lc ${shellQuote(fullCommand)}`;
}

export function buildPowerShellCommand(
  command: string,
  cwd?: string,
  env?: Record<string, string>,
): string {
  assertValidEnvironment(env);
  const envPrefix =
    env && Object.keys(env).length > 0
      ? Object.entries(env)
          .map(([key, value]) => `$env:${key} = ${powerShellQuote(value)}`)
          .join("; ") + "; "
      : "";

  const cwdPrefix = cwd ? `Set-Location -Path ${powerShellQuote(cwd)}; ` : "";
  const script = `${envPrefix}${cwdPrefix}${command}`;

  return `powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ${powerShellQuote(script)}`;
}

export function buildRemoteCommand(
  command: string,
  osInfo: OSInfo,
  cwd?: string,
  env?: Record<string, string>,
): string {
  if (osInfo.platform === "windows") {
    return buildPowerShellCommand(command, cwd, env);
  }

  const shellName = osInfo.defaultShell === "bash" ? "bash" : "sh";
  return buildPosixCommand(command, cwd, env, shellName);
}

export function buildRemoteCommandWithTimeout(
  command: string,
  osInfo: OSInfo,
  timeoutMs: number,
  cwd?: string,
  env?: Record<string, string>,
): string {
  const remoteCommand = buildRemoteCommand(command, osInfo, cwd, env);
  if (osInfo.platform === "windows") {
    return remoteCommand;
  }

  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const killAfterSeconds = 2;
  return [
    "if command -v timeout >/dev/null 2>&1; then",
    `timeout -k ${killAfterSeconds}s ${timeoutSeconds}s ${remoteCommand};`,
    "else",
    `${remoteCommand};`,
    "fi",
  ].join(" ");
}

export function buildSudoCommand(command: string, osInfo: OSInfo, cwd?: string): string {
  if (osInfo.platform === "windows") {
    throw new Error("Sudo is not supported on Windows hosts");
  }

  let sudoCommand = command;

  if (cwd) {
    sudoCommand = `cd ${shellQuote(cwd)} && ${command}`;
  }

  const prefixed = `sudo -n ${sudoCommand}`;

  const shellName = osInfo.defaultShell === "bash" ? "bash" : "sh";
  return buildPosixCommand(prefixed, undefined, undefined, shellName);
}

export function resolveRemoteTempDir(osInfo: OSInfo): string {
  if (osInfo.tempDir) {
    return osInfo.tempDir.replace(/\\\\/g, "/").replace(/\\/g, "/");
  }

  if (osInfo.platform === "windows") {
    return "C:/Windows/Temp";
  }

  return "/tmp";
}
