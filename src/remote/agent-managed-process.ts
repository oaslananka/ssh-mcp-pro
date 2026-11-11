import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { AgentPolicy, RemoteErrorCode } from "./types.js";

type SessionStatus = "running" | "exited" | "stopped" | "timed_out" | "failed";
type StreamName = "stdout" | "stderr";
interface OutputEvent {
  cursor: number;
  stream: StreamName;
  text: string;
}
interface ManagedSession {
  id: string;
  ownerId: string;
  agentId: string;
  child: ChildProcessWithoutNullStreams;
  status: SessionStatus;
  exitCode: number | null;
  chunks: OutputEvent[];
  nextCursor: number;
  droppedBeforeCursor: number;
  bufferedBytes: number;
  inputBytes: number;
  timeout: NodeJS.Timeout;
  retention?: NodeJS.Timeout;
  decoders: Record<StreamName, StringDecoder>;
}
const MAX_ACTIVE = 4;
const MAX_RETAINED = 20;
const MAX_BUFFER_BYTES = 64 * 1024;
const MAX_BUFFER_EVENTS = 512;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_INPUT_PER_CALL = 4096;
const MAX_RUNTIME_SECONDS = 600;
const RETAIN_AFTER_EXIT_MS = 2 * 60 * 1000;

function denied(message: string, code: RemoteErrorCode = "POLICY_DENIED"): Error {
  return Object.assign(new Error(message), { code });
}

function integerArg(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw denied(name + " must be an integer between " + min + " and " + max);
  }
  return value;
}

function executableShell(command: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    };
  }
  return { command: "/bin/sh", args: ["-lc", command] };
}

function terminateTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) {
    child.kill("SIGTERM");
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill("SIGTERM");
    });
    killer.on("close", (code) => {
      if (code !== 0 && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const timer = setTimeout(() => {
    try {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
  }, 1500);
  timer.unref();
}

/** Agent-local bounded process registry. The control plane never owns a shell process. */
export class ManagedProcessRegistry {
  private readonly sessions = new Map<string, ManagedSession>();
  private closed = false;

  async start(
    ownerId: string,
    agentId: string,
    args: Record<string, unknown>,
    stillAuthorized: () => boolean,
  ): Promise<{ process_id: string; status: SessionStatus; max_runtime_seconds: number }> {
    if (this.closed) throw denied("Agent process manager is closed");
    const command = args.command;
    if (typeof command !== "string" || !command.trim() || command.length > 4096) {
      throw denied("command must be a nonempty string of at most 4096 characters");
    }
    const maxRuntime = integerArg(
      args.max_runtime_seconds,
      300,
      1,
      MAX_RUNTIME_SECONDS,
      "max_runtime_seconds",
    );
    const cwd = args.cwd;
    if (cwd !== undefined && (typeof cwd !== "string" || !cwd || cwd.length > 4096)) {
      throw denied("cwd must be a nonempty path");
    }
    if (cwd !== undefined) {
      try {
        await access(cwd);
      } catch {
        throw denied("cwd is not accessible");
      }
    }
    if (!stillAuthorized())
      throw denied("shell.exec was revoked before process start", "CAPABILITY_DENIED");
    this.pruneFinished();
    const active = [...this.sessions.values()].filter((x) => x.status === "running").length;
    if (active >= MAX_ACTIVE) throw denied("Too many active managed processes on this agent");
    const shell = executableShell(command);
    const child = spawn(shell.command, shell.args, {
      cwd,
      stdio: "pipe",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const processId = "proc_" + randomUUID().replaceAll("-", "");
    const session: ManagedSession = {
      id: processId,
      ownerId,
      agentId,
      child,
      status: "running",
      exitCode: null,
      chunks: [],
      nextCursor: 0,
      droppedBeforeCursor: 0,
      bufferedBytes: 0,
      inputBytes: 0,
      timeout: setTimeout(() => {
        if (session.status === "running") {
          session.status = "timed_out";
          terminateTree(child);
        }
      }, maxRuntime * 1000),
      decoders: { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") },
    };
    session.timeout.unref();
    this.sessions.set(processId, session);
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].on("data", (chunk: Buffer) => {
        this.append(session, stream, session.decoders[stream].write(chunk));
      });
    }
    // Writing to a process that exits concurrently must not crash the agent.
    child.stdin.on("error", () => undefined);
    child.on("error", () => {
      session.status = "failed";
      session.exitCode = 127;
      this.append(session, "stderr", "Process could not be started");
    });
    child.on("close", (code) => {
      clearTimeout(session.timeout);
      for (const stream of ["stdout", "stderr"] as const) {
        this.append(session, stream, session.decoders[stream].end());
      }
      if (session.status === "running") session.status = "exited";
      session.exitCode ??= code;
      if (!this.closed) {
        session.retention = setTimeout(() => {
          this.sessions.delete(session.id);
        }, RETAIN_AFTER_EXIT_MS);
        session.retention.unref();
        this.pruneFinished();
      }
    });
    return { process_id: processId, status: "running", max_runtime_seconds: maxRuntime };
  }

  read(ownerId: string, agentId: string, args: Record<string, unknown>, policy: AgentPolicy) {
    const session = this.lookup(ownerId, agentId, args.process_id);
    const cursor = integerArg(args.cursor, 0, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const maxBytes = integerArg(
      args.max_bytes,
      Math.min(8192, policy.maxOutputBytes),
      1024,
      32768,
      "max_bytes",
    );
    if (maxBytes > policy.maxOutputBytes)
      throw denied("Output budget is below requested max_bytes");
    const start = Math.max(cursor, session.droppedBeforeCursor);
    const result = {
      process_id: session.id,
      status: session.status,
      exit_code: session.exitCode,
      dropped_before_cursor: session.droppedBeforeCursor,
      next_cursor: start,
      chunks: [] as OutputEvent[],
    };
    for (const entry of session.chunks) {
      if (entry.cursor < start) continue;
      const candidate = {
        ...result,
        next_cursor: entry.cursor + 1,
        chunks: [...result.chunks, entry],
      };
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > maxBytes) break;
      result.next_cursor = entry.cursor + 1;
      result.chunks.push(entry);
    }
    return result;
  }

  input(ownerId: string, agentId: string, args: Record<string, unknown>) {
    const session = this.lookup(ownerId, agentId, args.process_id);
    const value = args.input;
    if (typeof value !== "string" || Buffer.byteLength(value) > MAX_INPUT_PER_CALL) {
      throw denied("input must be a string of at most 4096 bytes");
    }
    if (
      session.status !== "running" ||
      session.child.stdin.destroyed ||
      session.child.stdin.writableEnded
    ) {
      throw denied("Managed process is no longer accepting input");
    }
    const bytes = Buffer.byteLength(value);
    if (session.inputBytes + bytes > MAX_INPUT_BYTES || session.child.stdin.writableLength > 8192) {
      throw denied("Managed process input budget exceeded");
    }
    if (args.close_stdin !== undefined && typeof args.close_stdin !== "boolean") {
      throw denied("close_stdin must be boolean");
    }
    session.inputBytes += bytes;
    session.child.stdin.write(value);
    if (args.close_stdin === true) session.child.stdin.end();
    return {
      process_id: session.id,
      written_bytes: bytes,
      stdin_closed: args.close_stdin === true,
    };
  }

  stop(ownerId: string, agentId: string, args: Record<string, unknown>) {
    const session = this.lookup(ownerId, agentId, args.process_id);
    this.cancel(session);
    return { process_id: session.id, status: session.status };
  }

  stopAll(): void {
    for (const session of this.sessions.values()) this.cancel(session);
  }

  dispose(): void {
    this.closed = true;
    for (const session of this.sessions.values()) {
      clearTimeout(session.timeout);
      if (session.retention) clearTimeout(session.retention);
      this.cancel(session);
    }
    this.sessions.clear();
  }

  private lookup(ownerId: string, agentId: string, id: unknown): ManagedSession {
    const item = typeof id === "string" ? this.sessions.get(id) : undefined;
    if (item?.ownerId !== ownerId || item.agentId !== agentId) {
      throw denied("Process not found for this agent and user");
    }
    return item;
  }

  private cancel(session: ManagedSession): void {
    if (session.status !== "running") return;
    session.status = "stopped";
    clearTimeout(session.timeout);
    terminateTree(session.child);
  }

  private append(session: ManagedSession, stream: StreamName, text: string): void {
    if (this.closed || !text) return;
    const characters = Array.from(text);
    for (let offset = 0; offset < characters.length; offset += 128) {
      const part = characters.slice(offset, offset + 128).join("");
      const entry: OutputEvent = { cursor: session.nextCursor++, stream, text: part };
      session.chunks.push(entry);
      session.bufferedBytes += Buffer.byteLength(part, "utf8");
      while (
        session.bufferedBytes > MAX_BUFFER_BYTES ||
        session.chunks.length > MAX_BUFFER_EVENTS
      ) {
        const removed = session.chunks.shift();
        if (!removed) break;
        session.bufferedBytes -= Buffer.byteLength(removed.text, "utf8");
        session.droppedBeforeCursor = removed.cursor + 1;
      }
    }
  }

  private pruneFinished(): void {
    const finished = [...this.sessions.values()].filter((session) => session.status !== "running");
    while (finished.length > MAX_RETAINED) {
      const removed = finished.shift();
      if (!removed) break;
      if (removed.retention) clearTimeout(removed.retention);
      this.sessions.delete(removed.id);
    }
  }
}
