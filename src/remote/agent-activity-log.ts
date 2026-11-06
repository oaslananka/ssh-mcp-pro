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

/** Local, bounded diagnostics. Never record shell arguments, outputs, keys or tokens. */
export function agentActivityLogPath(agentConfigPath: string): string {
  return path.join(path.dirname(agentConfigPath), "logs", "agent-activity.jsonl");
}

function cleanLabel(value: string, limit = 72): string {
  return value
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replaceAll(/[^\p{L}\p{N} .:_()/-]/gu, "?")
    .trim()
    .slice(0, limit);
}

function paint(value: string, level: AgentActivityLevel, color: boolean): string {
  if (!color) return value;
  const code = { info: "36", ok: "32", warn: "33", error: "31" }[level];
  return "\u001b[" + code + "m" + value + "\u001b[0m";
}

function formatEntry(entry: AgentActivityEntry, color: boolean): string {
  const time = entry.timestamp.slice(11, 19);
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
    private readonly options: { maxBytes?: number; maxArchives?: number } = {},
  ) {
    this.file = agentActivityLogPath(configFile);
  }

  banner(alias: string, profile: string, version: number): void {
    const tty = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
    const lines = [
      "",
      "╭" + "─".repeat(57) + "╮",
      "│  " + paint("SSH MCP PRO", "info", tty) + "  ·  OUTBOUND AGENT ACTIVITY",
      "│  DEVICE   " + cleanLabel(alias, 30),
      "│  ACCESS   " + cleanLabel(profile, 24) + "  ·  Policy v" + version,
      "│  STATUS   CONNECTING  /  waiting for authenticated server",
      "╰" + "─".repeat(57) + "╯",
      "  Activity log: " + this.file,
      "  Review: ssh-mcp-pro-agent logs --follow",
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

  private append(entry: AgentActivityEntry): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) return;

    // O_NOFOLLOW and the open descriptor avoid the check-then-append race.
    // Windows supports the same path with its platform-specific open flags.
    const flags =
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
    const row = JSON.stringify(entry) + "\n";
    let descriptor: number | undefined = openSync(this.file, flags, 0o600);
    try {
      const maxBytes = this.options.maxBytes ?? MAX_LOG_BYTES;
      if (fstatSync(descriptor).size + Buffer.byteLength(row, "utf8") > maxBytes) {
        closeSync(descriptor);
        descriptor = undefined;
        this.rotate();
        descriptor = openSync(this.file, flags, 0o600);
      }
      writeSync(descriptor, row);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
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
  let data: string;
  let descriptor: number;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
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
