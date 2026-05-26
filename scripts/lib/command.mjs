import { spawnSync } from "node:child_process";
import process from "node:process";

const windowsCommandShims = new Set(["corepack", "npm", "npx", "pnpm", "pnpx", "yarn"]);

export function resolveExecutable(command) {
  if (
    process.platform !== "win32" ||
    /\.[a-z0-9]+$/iu.test(command) ||
    !windowsCommandShims.has(command)
  ) {
    return command;
  }

  return `${command}.cmd`;
}

export function runCommand(command, args, options = {}) {
  const executable = resolveExecutable(command);
  const spawnTarget = resolveSpawnTarget(executable, args);

  return spawnSync(spawnTarget.command, spawnTarget.args, {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    ...options,
  });
}

export function failWithCommandResult(label, result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }

  process.exit(result.status ?? 1);
}

export function commandFailure(label, result) {
  const output = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join("\n");
  return {
    ok: false,
    status: result.status ?? null,
    error: `${label} failed${output ? `: ${output.trim()}` : "."}`,
  };
}

function resolveSpawnTarget(command, args) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/iu.test(command)) {
    return { command, args };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: [
      "/d",
      "/c",
      [quoteWindowsCommandArg(command), ...args.map(quoteWindowsCommandArg)].join(" "),
    ],
  };
}

function quoteWindowsCommandArg(value) {
  const text = String(value);
  if (/^[^\s"&|<>^]+$/u.test(text)) {
    return text;
  }

  throw new Error(`Windows command argument contains unsupported shell characters: ${text}`);
}
