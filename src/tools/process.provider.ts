import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logger, redactSensitiveData } from "../logging.js";
import type { MetricsCollector } from "../metrics.js";
import type { ProcessService } from "../process.js";
import { addSafetyWarningToResult } from "../safety.js";
import type { StreamingService } from "../streaming.js";
import { ExecSchema, ExecStreamSchema, SudoSchema } from "../types.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

export interface ProcessToolProviderDeps {
  processService: ProcessService;
  streamingService: StreamingService;
  metrics: MetricsCollector;
}

export class ProcessToolProvider implements ToolProvider {
  readonly namespace = "process";

  constructor(private readonly deps: ProcessToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "proc_exec",
        description:
          "Executes a non-interactive command on the remote system after policy and safety checks",
        annotations: annotate({
          title: "Execute Remote Command",
          readOnly: false,
          destructive: false,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Remote command result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            command: { type: "string", description: "Command to execute" },
            cwd: { type: "string", description: "Working directory" },
            env: { type: "object", description: "Environment variables" },
            timeoutMs: {
              type: "number",
              description: "Command execution timeout in milliseconds",
            },
          },
          required: ["sessionId", "command"],
        },
      },
      {
        name: "proc_sudo",
        description:
          "Executes a command with sudo privileges only when allowRawSudo policy permits it",
        annotations: annotate({
          title: "Execute Sudo Command",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Remote sudo command result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            command: {
              type: "string",
              description: "Command to execute with sudo",
            },
            cwd: { type: "string", description: "Working directory" },
            timeoutMs: {
              type: "number",
              description: "Command execution timeout in milliseconds",
            },
          },
          required: ["sessionId", "command"],
        },
      },
      {
        name: "proc_exec_stream",
        description: "Executes a command and returns streaming output chunks",
        annotations: annotate({
          title: "Execute Streaming Command",
          readOnly: false,
          destructive: false,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Streaming command result with output chunks"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            command: { type: "string", description: "Command to execute" },
            cwd: { type: "string", description: "Working directory" },
            env: { type: "object", description: "Environment variables" },
            timeoutMs: {
              type: "number",
              description: "Streaming command timeout in milliseconds",
            },
          },
          required: ["sessionId", "command"],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "proc_exec":
        return this.exec(args);
      case "proc_sudo":
        return this.sudo(args);
      case "proc_exec_stream":
        return this.execStream(args);
      default:
        return undefined;
    }
  }

  private async exec(args: unknown): Promise<unknown> {
    const params = ExecSchema.parse(args);
    const result = await this.deps.processService.execCommand(
      params.sessionId,
      params.command,
      params.cwd,
      params.env,
      params.timeoutMs,
    );
    this.deps.metrics.recordCommand(result.durationMs, result.code === 0);
    logger.info("Command executed", {
      sessionId: params.sessionId,
      command: redactSensitiveData(params.command),
    });
    return addSafetyWarningToResult(params.command, result);
  }

  private async sudo(args: unknown): Promise<unknown> {
    const params = SudoSchema.parse(args);
    const result = await this.deps.processService.execSudo(
      params.sessionId,
      params.command,
      undefined,
      params.cwd,
      params.timeoutMs,
    );
    this.deps.metrics.recordCommand(result.durationMs, result.code === 0);
    logger.info("Sudo command executed", {
      sessionId: params.sessionId,
      command: redactSensitiveData(params.command),
    });
    return addSafetyWarningToResult(params.command, result);
  }

  private async execStream(args: unknown): Promise<unknown> {
    const params = ExecStreamSchema.parse(args);
    const result = await this.deps.streamingService.execWithStreaming(
      this.buildStreamOptions(params),
    );
    this.deps.metrics.recordCommand(result.durationMs, result.code === 0);
    logger.info("Streaming command executed", {
      sessionId: params.sessionId,
      command: redactSensitiveData(params.command),
      chunks: result.chunks.length,
    });
    return addSafetyWarningToResult(params.command, result);
  }

  private buildStreamOptions(params: {
    sessionId: string;
    command: string;
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    timeoutMs?: number | undefined;
  }) {
    return {
      sessionId: params.sessionId,
      command: params.command,
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.env ? { env: params.env } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    };
  }
}
