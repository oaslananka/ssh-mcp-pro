import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logging.js";
import type { MetricsCollector } from "../metrics.js";
import type { SessionManager } from "../session.js";
import { MetricsFormatSchema, SessionIdSchema } from "../types.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

export interface SystemToolProviderDeps {
  sessionManager: SessionManager;
  metrics: MetricsCollector;
}

export class SystemToolProvider implements ToolProvider {
  readonly namespace = "system";

  constructor(private readonly deps: SystemToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "os_detect",
        description: "Detects operating system and environment information",
        annotations: annotate({
          title: "Detect Remote OS",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Remote operating system information"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "get_metrics",
        description:
          "Returns server metrics including session counts, command statistics, and uptime",
        annotations: annotate({
          title: "Get Runtime Metrics",
          readOnly: true,
          idempotent: true,
          openWorld: false,
        }),
        outputSchema: objectOutputSchema("Runtime metrics"),
        inputSchema: {
          type: "object" as const,
          properties: {
            format: {
              type: "string",
              enum: ["json", "prometheus"],
              description: "Output format (default: json)",
            },
          },
          required: [],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "os_detect":
        return this.detect(args);
      case "get_metrics":
        return this.getMetrics(args);
      default:
        return undefined;
    }
  }

  private async detect(args: unknown): Promise<unknown> {
    const { sessionId } = SessionIdSchema.parse(args);
    const result = await this.deps.sessionManager.getOSInfo(sessionId);
    logger.info("OS detected", { sessionId });
    return result;
  }

  private async getMetrics(args: unknown): Promise<unknown> {
    const { format } = MetricsFormatSchema.parse(args ?? {});
    if (format === "prometheus") {
      return this.deps.metrics.exportPrometheus();
    }
    logger.debug("Metrics retrieved");
    return this.deps.metrics.getMetrics();
  }
}
