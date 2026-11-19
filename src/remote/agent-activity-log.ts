import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  watchFile,
  closeSync,
  constants,
  fstatSync,
  openSync,
  writeSync,
} from "node:fs";
import path from "node:path";

export type AgentActivityLevel = "info" | "ok" | "warn" | "error";

export interface AgentActivityEntry {
  timestamp: string;
  level: AgentActivityLevel;
  event: string;
  message: string;
}

const MAX_LOG_BYTES = 512 * 1024;
const MAX_ARCHIVES = 2;
const DEFAULT_TAIL = 60;

type AgentAction = { action_id: string; tool: string; args: Record<string, unknown> };
type AgentResult = {
  status: "ok" | "error";
  exit_code?: number | undefined;
  error_code?: string | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  truncated: boolean;
};
interface ActivityOptions {
  maxBytes?: number;
  maxArchives?: number;
  detail?: "compact" | "verbose" | undefined;
  /** Opt-in local-console-only preview; never written to JSONL. */
  showCommands?: boolean | undefined;
  /** Opt-in console-only output snippets; output remains excluded from JSONL. */
  showOutput?: boolean | undefined;
}

/** Only these entire commands are safe enough to persist as ordinary labels. */
const SAFE_COMMAND =
  /^(?:git (?:status(?: -sb| --short)?|diff --stat|branch(?: --show-current)?|rev-parse HEAD|log -1 --oneline)|node (?:-v|--version)|pnpm (?:-v|--version|test|run (?:lint|typecheck|check:quality))|npm --version)$/u;
const SENSITIVE_NAME =
  /(?:token|secret|password|private|credential|authorization|cookie|api[_-]?key|\.env)/iu;
const PLAIN_FILE_NAME = /^[\p{L}\p{N} _().-]{1,72}$/u;
const KNOWN_EXECUTABLE =
  /^(?:git|node|pnpm|npm|python|python3|powershell|pwsh|cmd|docker|uv|uvx|npx|bash|sh)$/iu;

function actionLabel(action: AgentAction): string {
  const operation = action.tool
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_]/gu, "")
    .slice(0, 24);
  const identifier = action.action_id
    .replace(/^act_/u, "")
    .replaceAll(/[^a-zA-Z0-9_-]/gu, "")
    .slice(0, 8);
  return operation + "  #" + (identifier || "unknown");
}

function safeCommandSummary(value: unknown): string {
  if (typeof value !== "string") return "command details hidden";
  const command = value.trim();
  if (SAFE_COMMAND.test(command)) return command;
  const executable = /^([A-Za-z][\w.-]*)\b/u.exec(command)?.[1];
  if (executable && KNOWN_EXECUTABLE.test(executable)) {
    return executable.toLowerCase() + " [arguments hidden]";
  }
  return "command details hidden";
}

function safeFileSummary(value: unknown): string {
  if (typeof value !== "string") return "file details hidden";
  const basename = value.split(/[\\/]/u).at(-1) ?? "";
  if (!PLAIN_FILE_NAME.test(basename) || SENSITIVE_NAME.test(basename)) {
    return "file details hidden";
  }
  return basename;
}

function actionSummary(action: AgentAction): string {
  const { tool, args } = action;
  if (tool === "run_shell" || tool === "run_shell_as_root" || tool === "process_start") {
    return safeCommandSummary(args.command);
  }
  if (tool === "file_replace") {
    return (args.dry_run === false ? "APPLY " : "PREVIEW ") + safeFileSummary(args.path);
  }
  if (tool.startsWith("file_")) return safeFileSummary(args.path);
  if (tool === "process_read" || tool === "process_stop" || tool === "process_input") {
    const processId = args.process_id;
    if (typeof processId === "string" && /^[a-f0-9-]{12,48}$/iu.test(processId)) {
      return "process #" + processId.slice(0, 8);
    }
    return "managed process";
  }
  return "request";
}

function lineCount(value: string | undefined): number {
  if (!value) return 0;
  return value.split(/\r?\n/u).length - (/\r?\n$/u.test(value) ? 1 : 0);
}

/** Parse only enumerated process metadata; never put chunk text into diagnostics. */
function safeProcessProgress(action: AgentAction, result: AgentResult): string[] {
  if (action.tool !== "process_read" || result.status !== "ok" || !result.stdout) return [];
  try {
    const payload: unknown = JSON.parse(result.stdout);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const data = payload as Record<string, unknown>;
    const progress: string[] = [];
    if (Array.isArray(data.chunks) && data.chunks.length <= 512) {
      progress.push("chunks=" + data.chunks.length);
    }
    if (
      typeof data.status === "string" &&
      ["running", "exited", "stopped", "timed_out", "failed"].includes(data.status)
    ) {
      progress.push(data.status);
    }
    if (
      typeof data.next_cursor === "number" &&
      Number.isSafeInteger(data.next_cursor) &&
      data.next_cursor >= 0
    ) {
      progress.push("cursor=" + data.next_cursor);
    }
    return progress;
  } catch {
    return [];
  }
}

function durationLabel(ms: number): string {
  return ms >= 1_000 ? (ms / 1_000).toFixed(2) + " s" : Math.round(ms) + " ms";
}

function consolePreview(value: string, max = 160): string {
  // Explicit opt-in, console-only, best-effort redaction. Never persisted.
  const cleaned = value.replaceAll(/[\u0000-\u001f\u007f-\u009f\u001b]/gu, " ");
  const obscured = cleaned
    .replaceAll(/https?:\/\/[^\s"']+/giu, "[REDACTED URL]")
    .replaceAll(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replaceAll(
      /(?:--?|\/)[\w-]*(?:token|pass(?:word)?|secret|key|auth|cookie|credential)[\w-]*(?:=|:|\s+)(?:"[^"]*"|'[^']*'|\S+)/giu,
      "[REDACTED]",
    )
    .replaceAll(
      /\b(?:TOKEN|PASSWORD|SECRET|API_KEY|AUTHORIZATION)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/giu,
      "[REDACTED]",
    );
  return obscured.slice(0, max) + (obscured.length > max ? "…" : "");
}

/** Build diagnostics without retaining command arguments or output text. */
function actionResultFields(
  action: AgentAction,
  result: AgentResult,
  durationMs: number,
): string[] {
  const nonZeroExit = typeof result.exit_code === "number" && result.exit_code !== 0;
  const outcome = result.status === "error" ? "ERROR" : nonZeroExit ? "NONZERO EXIT" : "OK";
  const fields = [outcome, "in " + durationLabel(durationMs)];
  if (typeof result.exit_code === "number" && Number.isFinite(result.exit_code)) {
    fields.push("exit=" + result.exit_code);
  }
  fields.push(...safeProcessProgress(action, result));
  if (action.tool !== "process_read" || result.status !== "ok") {
    fields.push(
      "stdout=" + lineCount(result.stdout) + " lines",
      "stderr=" + lineCount(result.stderr) + " lines",
    );
  }
  if (result.truncated) fields.push("truncated");
  if (result.error_code && /^[A-Z_]{1,48}$/u.test(result.error_code)) {
    fields.push(result.error_code);
  }
  return fields;
}

function resultEventLevel(result: AgentResult): AgentActivityLevel {
  if (result.status === "error") return "error";
  return typeof result.exit_code === "number" && result.exit_code !== 0 ? "warn" : "ok";
}

/** Local, bounded diagnostics. Never record shell arguments, outputs, keys or tokens. */
export function agentActivityLogPath(agentConfigPath: string): string {
  return path.join(path.dirname(agentConfigPath), "logs", "agent-activity.jsonl");
}

function cleanLabel(value: string, limit = 72): string {
  return value
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replaceAll(/[^\p{L}\p{N} .:_()/#=\[\]·-]/gu, "?")
    .trim()
    .slice(0, limit);
}

function paint(value: string, level: AgentActivityLevel, color: boolean): string {
  if (!color) return value;
  const code = { info: "36", ok: "32", warn: "33", error: "31" }[level];
  return "\u001b[" + code + "m" + value + "\u001b[0m";
}

function formatEntry(entry: AgentActivityEntry, color: boolean): string {
  const time = entry.timestamp.slice(11, 23);
  return (
    time +
    "  " +
    paint(entry.level.toUpperCase().padEnd(5), entry.level, color) +
    "  " +
    entry.message
  );
}

export class AgentActivityLog {
  readonly file: string;
  private fileWarningEmitted = false;

  constructor(
    configFile: string,
    private readonly options: ActivityOptions = {},
  ) {
    this.file = agentActivityLogPath(configFile);
  }

  banner(alias: string, profile: string, version: number): void {
    const tty = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
    const detail =
      this.options.detail ??
      (process.env.SSHAUTOMATOR_AGENT_LOG_DETAIL === "verbose" ? "verbose" : "compact");
    const panelRow = (value: string) => "│  " + cleanLabel(value, 53).padEnd(53) + "  │";
    const lines = [
      "",
      "╭" + "─".repeat(57) + "╮",
      paint(panelRow("SSH MCP PRO  ·  OUTBOUND AGENT ACTIVITY"), "info", tty),
      panelRow("DEVICE   " + cleanLabel(alias, 30)),
      panelRow("ACCESS   " + cleanLabel(profile, 24) + "  ·  Policy v" + version),
      panelRow("STATUS   CONNECTING  /  authenticating server"),
      panelRow("DETAIL   " + detail.toUpperCase() + "  ·  sensitive payloads hidden"),
      "╰" + "─".repeat(57) + "╯",
      "  Activity log: " + this.file,
      "  Review: ssh-mcp-pro-agent logs --follow",
      "  Detail: ssh-mcp-pro-agent run --verbose",
      "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
  }

  event(level: AgentActivityLevel, event: string, message: string): void {
    // Callers supply fixed local event labels and sanitized diagnostic descriptions.
    const entry: AgentActivityEntry = {
      timestamp: new Date().toISOString(),
      level,
      event: cleanLabel(event, 48),
      message: cleanLabel(message, 180),
    };
    process.stdout.write(
      formatEntry(entry, Boolean(process.stdout.isTTY && !process.env.NO_COLOR)) + "\n",
    );
    try {
      this.append(entry);
    } catch {
      // Losing a diagnostic file must not interrupt an authenticated agent.
      if (!this.fileWarningEmitted) {
        this.fileWarningEmitted = true;
        process.stderr.write("Agent activity log unavailable; console events will continue.\n");
      }
    }
  }

  actionStarted(action: AgentAction): void {
    const label = actionLabel(action);
    this.event("info", "action_started", label + "  " + actionSummary(action));
    const detail =
      this.options.detail ??
      (process.env.SSHAUTOMATOR_AGENT_LOG_DETAIL === "verbose" ? "verbose" : "compact");
    if (detail !== "verbose") return;
    const commandVisibility =
      this.options.showCommands ?? process.env.SSHAUTOMATOR_AGENT_LOG_COMMANDS === "1";
    if (
      action.tool === "run_shell" ||
      action.tool === "run_shell_as_root" ||
      action.tool === "process_start"
    ) {
      const command = action.args.command;
      const safe = safeCommandSummary(command);
      const preview =
        commandVisibility && typeof command === "string" ? consolePreview(command) : safe;
      process.stdout.write("    command: " + preview + "\n");
      if (commandVisibility && typeof action.args.cwd === "string") {
        process.stdout.write("    cwd: " + consolePreview(action.args.cwd, 120) + "\n");
      }
    } else if (action.tool.startsWith("file_")) {
      process.stdout.write("    file: " + safeFileSummary(action.args.path) + "\n");
    }
  }

  actionFinished(action: AgentAction, result: AgentResult, durationMs: number): void {
    this.event(
      resultEventLevel(result),
      "action_finished",
      actionLabel(action) + "  " + actionResultFields(action, result, durationMs).join("  ·  "),
    );
    this.showResultPreviews(result);
  }

  private showResultPreviews(result: AgentResult): void {
    const detail =
      this.options.detail ??
      (process.env.SSHAUTOMATOR_AGENT_LOG_DETAIL === "verbose" ? "verbose" : "compact");
    const showOutput = this.options.showOutput ?? process.env.SSHAUTOMATOR_AGENT_LOG_OUTPUT === "1";
    if (detail !== "verbose" || !showOutput) return;
    if (result.stdout) {
      process.stdout.write("    stdout preview: " + consolePreview(result.stdout) + "\n");
    }
    if (result.stderr) {
      process.stdout.write("    stderr preview: " + consolePreview(result.stderr) + "\n");
    }
  }

  private append(entry: AgentActivityEntry): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) return;

    // O_NOFOLLOW and the open descriptor avoid the check-then-append race.
    // Windows supports the same path with its platform-specific open flags.
    const flags =
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
    const row = JSON.stringify(entry) + "\n";
    const descriptor = openSync(this.file, flags, 0o600);
    let rotate = false;
    try {
      writeSync(descriptor, row);
      rotate = fstatSync(descriptor).size > (this.options.maxBytes ?? MAX_LOG_BYTES);
    } finally {
      closeSync(descriptor);
    }
    // Rotate only after closing the descriptor. Never check one file and reopen
    // it to write, which would introduce a symlink/TOCTOU window.
    if (rotate) this.rotate();
  }

  private rotate(): void {
    const archives = this.options.maxArchives ?? MAX_ARCHIVES;
    for (let n = archives; n >= 1; n--) {
      const target = this.file + "." + n;
      const source = n === 1 ? this.file : this.file + "." + (n - 1);
      rmSync(target, { force: true });
      try {
        renameSync(source, target);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function parseActivityEntry(line: string): AgentActivityEntry | undefined {
  if (!line) return undefined;
  try {
    const entry = JSON.parse(line) as Partial<AgentActivityEntry>;
    if (
      typeof entry.timestamp !== "string" ||
      typeof entry.event !== "string" ||
      typeof entry.message !== "string"
    )
      return undefined;
    if (
      entry.level !== "info" &&
      entry.level !== "ok" &&
      entry.level !== "warn" &&
      entry.level !== "error"
    )
      return undefined;
    return entry as AgentActivityEntry;
  } catch {
    // Ignore partial lines during rotation or concurrent append.
    return undefined;
  }
}

export function readAgentActivity(configFile: string, tail = DEFAULT_TAIL): AgentActivityEntry[] {
  if (!Number.isInteger(tail) || tail < 1 || tail > 200) {
    throw new Error("--tail must be an integer from 1 to 200");
  }
  const file = agentActivityLogPath(configFile);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let data: string;
  let descriptor: number;
  try {
    descriptor = openSync(file, flags);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    // A completed rotation temporarily has no active file. The latest
    // archived file still contains the most recent event until the next write.
    try {
      descriptor = openSync(file + ".1", flags);
    } catch (archiveError) {
      if (isMissingFile(archiveError)) return [];
      throw archiveError;
    }
  }
  try {
    data = readFileSync(descriptor, "utf8").slice(-(MAX_LOG_BYTES + 2048));
  } finally {
    closeSync(descriptor);
  }
  const entries: AgentActivityEntry[] = [];
  for (const line of data.split("\n")) {
    const entry = parseActivityEntry(line);
    if (entry) entries.push(entry);
  }
  return entries.slice(-tail);
}

/** Local Windows/Linux monitor; never performs remote commands or accesses secrets. */
export async function showAgentActivityLogs(configFile: string, argv: string[]): Promise<void> {
  const follow = argv.includes("--follow") || argv.includes("-f");
  const index = argv.indexOf("--tail");
  const tail = index >= 0 ? Number(argv[index + 1]) : DEFAULT_TAIL;
  const events = readAgentActivity(configFile, tail);
  const logPath = agentActivityLogPath(configFile);
  const color = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  process.stdout.write("SSH MCP PRO · Agent activity\n" + logPath + "\n\n");
  for (const entry of events) {
    process.stdout.write(formatEntry(entry, color) + "\n");
  }
  if (!follow) return;
  process.stdout.write("\nFollowing events · Press Ctrl+C to stop\n");
  let previous = events.at(-1);
  await new Promise<void>(() => {
    watchFile(logPath, { interval: 1_000 }, () => {
      const current = readAgentActivity(configFile, 200);
      let previousIndex = -1;
      for (let i = current.length - 1; i >= 0; i--) {
        if (previous && JSON.stringify(current[i]) === JSON.stringify(previous)) {
          previousIndex = i;
          break;
        }
      }
      const unseen = previousIndex < 0 ? current.slice(-tail) : current.slice(previousIndex + 1);
      for (const entry of unseen) {
        process.stdout.write(formatEntry(entry, color) + "\n");
      }
      previous = current.at(-1);
    });
  });
}
