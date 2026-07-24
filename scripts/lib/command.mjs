import { spawnSync } from "node:child_process";
import process from "node:process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const WINDOWS_SHIMS = new Set(["npm", "npx", "pnpm"]);
const nodeBinDir = dirname(process.execPath);
const WINDOWS_NODE_CLIS = {
  npm: join(nodeBinDir, "node_modules", "npm", "bin", "npm-cli.js"),
  npx: join(nodeBinDir, "node_modules", "npm", "bin", "npx-cli.js"),
  pnpm: join(nodeBinDir, "node_modules", "corepack", "dist", "pnpm.js"),
};

export function executable(command) {
  if (process.platform !== "win32" || !WINDOWS_SHIMS.has(command)) {
    return command;
  }
  return `${command}.cmd`;
}

function usesWindowsCommandShim(command) {
  const normalized = command.toLowerCase().replace(/\.cmd$/u, "");
  return process.platform === "win32" && WINDOWS_SHIMS.has(normalized);
}

function findShimInPath(command) {
  const pathDirs = (process.env.PATH ?? "").split(";").filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, `${command}.cmd`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function invocation(command, args) {
  if (!usesWindowsCommandShim(command)) {
    return { command: executable(command), args };
  }
  const normalized = command.toLowerCase().replace(/\.cmd$/u, "");
  const pathShim = findShimInPath(normalized);
  if (pathShim) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/c", pathShim, ...args],
    };
  }
  const cli = WINDOWS_NODE_CLIS[normalized];
  if (cli && existsSync(cli)) {
    return { command: process.execPath, args: [cli, ...args] };
  }
  const commandLine = [executable(command), ...args].map(quoteWindowsCommandArg).join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
  };
}

function quoteWindowsCommandArg(value) {
  if (/^[a-zA-Z0-9_/:=.,@%+-]+$/u.test(value)) {
    return value;
  }
  return `"${value.replace(/(["^&|<>])/gu, "^$1")}"`;
}

const SHELL_INJECTION_CHARS = /[;|&`$()\n\r]/u;

function validateArgs(args) {
  for (const arg of args) {
    if (typeof arg === "string" && SHELL_INJECTION_CHARS.test(arg)) {
      throw new Error(`Refusing to execute command with shell metacharacters in argument: ${arg}`);
    }
  }
}

export function capture(command, args, options = {}) {
  validateArgs(args);
  const target = invocation(command, args);
  return spawnSync(target.command, target.args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
}

export function run(command, args, options = {}) {
  validateArgs(args);
  const target = invocation(command, args);
  const result = spawnSync(target.command, target.args, {
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.error || result.status !== 0) {
    failFromResult(result, command);
  }
  return result;
}

export function printResultOutput(result) {
  if (typeof result.stdout === "string" && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
}

export function failFromResult(result, label) {
  printResultOutput(result);
  if (result.error) {
    process.stderr.write(`${label} failed to start: ${result.error.message}\n`);
  }
  process.exit(result.status ?? 1);
}

// --- backward-compatible aliases for PR #59 consumers ---

export function runCommand(command, args, options = {}) {
  return capture(command, args, options);
}

export function failWithCommandResult(label, result) {
  failFromResult(result, label);
}

export function commandFailure(label, result) {
  const output = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join("\n");
  return {
    ok: false,
    status: result.status ?? null,
    error: `${label} failed${output ? `: ${output.trim()}` : "."}`,
  };
}
