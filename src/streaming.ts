import { logger } from "./logging.js";
import { createTimeoutError } from "./errors.js";
import { buildRemoteCommand } from "./shell.js";
import type { PolicyEngine } from "./policy.js";
import type { SessionManager } from "./session.js";
import type { ServerConfig } from "./config.js";

export interface StreamChunk {
  type: "stdout" | "stderr" | "exit" | "truncated";
  data?: string;
  code?: number;
  timestamp: number;
}

export interface StreamOptions {
  sessionId: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onChunk?: (chunk: StreamChunk) => void;
}

export interface StreamResult {
  code: number;
  chunks: StreamChunk[];
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface StreamingService {
  execWithStreaming(options: StreamOptions): Promise<StreamResult>;
}

export interface StreamingServiceDeps {
  sessionManager: Pick<SessionManager, "getSession" | "getOSInfo">;
  config: Pick<ServerConfig, "commandTimeoutMs" | "maxCommandOutputBytes" | "maxStreamChunks">;
  policy: Pick<PolicyEngine, "assertAllowed">;
}

function appendBounded(current: string, data: string, maxBytes: number) {
  const currentBytes = Buffer.byteLength(current, "utf8");
  const remaining = maxBytes - currentBytes;
  if (remaining <= 0) {
    return { value: current, truncated: data.length > 0 };
  }

  if (Buffer.byteLength(data, "utf8") <= remaining) {
    return { value: current + data, truncated: false };
  }

  let next = "";
  let used = 0;
  for (const char of data) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (used + charBytes > remaining) {
      break;
    }
    next += char;
    used += charBytes;
  }
  return { value: current + next, truncated: true };
}

export function createStreamingService({
  sessionManager,
  config,
  policy,
}: StreamingServiceDeps): StreamingService {
  async function execWithStreaming(options: StreamOptions): Promise<StreamResult> {
    const { sessionId, command, cwd, env, onChunk } = options;
    logger.debug("Starting streaming execution", { sessionId, command });

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
        chunks: [],
        stdout: JSON.stringify({ wouldExecute: true, command, policy: decision }, null, 2),
        stderr: "",
        durationMs: 0,
        truncated: false,
      };
    }

    const osInfo = await sessionManager.getOSInfo(sessionId);
    const startTime = Date.now();
    const chunks: StreamChunk[] = [];
    let fullStdout = "";
    let fullStderr = "";
    let truncated = false;

    return new Promise((resolve, reject) => {
      const shellCommand = buildRemoteCommand(command, osInfo, cwd, env);
      const timeout = setTimeout(() => {
        reject(
          createTimeoutError(
            `Streaming command timed out after ${options.timeoutMs ?? config.commandTimeoutMs}ms`,
            "Increase timeout or use a shorter streaming command.",
          ),
        );
      }, options.timeoutMs ?? config.commandTimeoutMs);

      session.ssh
        .execCommand(shellCommand, {
          onStdout: (chunk: Buffer) => {
            const data = chunk.toString();
            const bounded = appendBounded(fullStdout, data, config.maxCommandOutputBytes);
            fullStdout = bounded.value;
            truncated = truncated || bounded.truncated || chunks.length >= config.maxStreamChunks;

            if (chunks.length < config.maxStreamChunks && !bounded.truncated) {
              const streamChunk: StreamChunk = {
                type: "stdout",
                data,
                timestamp: Date.now(),
              };
              chunks.push(streamChunk);
              onChunk?.(streamChunk);
            }
          },
          onStderr: (chunk: Buffer) => {
            const data = chunk.toString();
            const bounded = appendBounded(fullStderr, data, config.maxCommandOutputBytes);
            fullStderr = bounded.value;
            truncated = truncated || bounded.truncated || chunks.length >= config.maxStreamChunks;

            if (chunks.length < config.maxStreamChunks && !bounded.truncated) {
              const streamChunk: StreamChunk = {
                type: "stderr",
                data,
                timestamp: Date.now(),
              };
              chunks.push(streamChunk);
              onChunk?.(streamChunk);
            }
          },
        })
        .then((result) => {
          clearTimeout(timeout);
          if (truncated) {
            const truncatedChunk: StreamChunk = {
              type: "truncated",
              data: "Output exceeded configured streaming limits",
              timestamp: Date.now(),
            };
            chunks.push(truncatedChunk);
            onChunk?.(truncatedChunk);
          }
          const exitChunk: StreamChunk = {
            type: "exit",
            code: result.code ?? 0,
            timestamp: Date.now(),
          };
          chunks.push(exitChunk);
          onChunk?.(exitChunk);

          const streamResult: StreamResult = {
            code: result.code ?? 0,
            chunks,
            stdout: fullStdout,
            stderr: fullStderr,
            durationMs: Date.now() - startTime,
            truncated,
          };

          logger.debug("Streaming execution completed", {
            sessionId,
            code: streamResult.code,
            chunkCount: chunks.length,
            durationMs: streamResult.durationMs,
          });

          resolve(streamResult);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  return { execWithStreaming };
}

export function formatStreamOutput(chunks: StreamChunk[]): string {
  return chunks
    .filter((chunk) => chunk.type !== "exit" && chunk.type !== "truncated" && chunk.data)
    .map((chunk) => chunk.data)
    .join("");
}
