import type { Tool } from "@modelcontextprotocol/server";
import { logger } from "../logging.js";
import type { MetricsCollector } from "../metrics.js";
import type { ProcessService } from "../process.js";
import type { SessionManager } from "../session.js";
import {
  DiskUsageSchema,
  LogTailSchema,
  MetricsFormatSchema,
  PortCheckSchema,
  ServiceLogsSchema,
  ServiceNameSchema,
  SessionIdSchema,
} from "../types.js";
import { annotate } from "./metadata.js";
import {
  EXEC_OUTPUT_SCHEMA,
  METRICS_OUTPUT_SCHEMA,
  OS_INFO_OUTPUT_SCHEMA,
} from "./output-schemas.js";
import { toolResult } from "./results.js";
import type { ToolProvider } from "./types.js";

export interface SystemToolProviderDeps {
  sessionManager: SessionManager;
  metrics: MetricsCollector;
  processService: ProcessService;
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
        outputSchema: OS_INFO_OUTPUT_SCHEMA,
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
        outputSchema: METRICS_OUTPUT_SCHEMA,
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
      {
        name: "service_list",
        description: "Lists all systemd services and their current state",
        annotations: annotate({
          title: "List Services",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "service_status",
        description: "Gets the status of a systemd service",
        annotations: annotate({
          title: "Service Status",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            name: { type: "string", description: "Service name (e.g. nginx or nginx.service)" },
          },
          required: ["sessionId", "name"],
        },
      },
      {
        name: "service_logs",
        description: "Reads recent journal logs for a systemd service",
        annotations: annotate({
          title: "Service Logs",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            name: { type: "string", description: "Service name" },
            lines: { type: "number", description: "Number of log lines to return (default: 50)" },
          },
          required: ["sessionId", "name"],
        },
      },
      {
        name: "service_restart",
        description: "Restarts a systemd service",
        annotations: annotate({
          title: "Restart Service",
          readOnly: false,
          destructive: false,
          idempotent: false,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            name: { type: "string", description: "Service name" },
          },
          required: ["sessionId", "name"],
        },
      },
      {
        name: "service_stop",
        description: "Stops a systemd service",
        annotations: annotate({
          title: "Stop Service",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            name: { type: "string", description: "Service name" },
          },
          required: ["sessionId", "name"],
        },
      },
      {
        name: "disk_usage",
        description: "Reports disk usage for filesystems on the remote system",
        annotations: annotate({
          title: "Disk Usage",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: {
              type: "string",
              description: "Optional path to check (default: all filesystems)",
            },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "memory_info",
        description: "Reports memory usage on the remote system",
        annotations: annotate({
          title: "Memory Info",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "cpu_usage",
        description: "Reports CPU load average and uptime on the remote system",
        annotations: annotate({
          title: "CPU Usage",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "net_interfaces",
        description: "Lists network interfaces and their IP addresses on the remote system",
        annotations: annotate({
          title: "Network Interfaces",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "port_check",
        description: "Checks which processes are listening on a specific port",
        annotations: annotate({
          title: "Port Check",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            port: { type: "number", description: "Port number to check (1-65535)" },
            host: { type: "string", description: "Host to check (default: 127.0.0.1)" },
          },
          required: ["sessionId", "port"],
        },
      },
      {
        name: "log_tail",
        description: "Tails the end of a log file or reads recent journal entries for a service",
        annotations: annotate({
          title: "Tail Log",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: EXEC_OUTPUT_SCHEMA,
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "Absolute path to a log file" },
            service: { type: "string", description: "Systemd service name for journal logs" },
            lines: { type: "number", description: "Number of lines to return (default: 50)" },
          },
          required: ["sessionId"],
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
      case "service_list":
        return this.serviceList(args);
      case "service_status":
        return this.serviceStatus(args);
      case "service_logs":
        return this.serviceLogs(args);
      case "service_restart":
        return this.serviceRestart(args);
      case "service_stop":
        return this.serviceStop(args);
      case "disk_usage":
        return this.diskUsage(args);
      case "memory_info":
        return this.memoryInfo(args);
      case "cpu_usage":
        return this.cpuUsage(args);
      case "net_interfaces":
        return this.netInterfaces(args);
      case "port_check":
        return this.portCheck(args);
      case "log_tail":
        return this.logTail(args);
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
      const metrics = this.deps.metrics.exportPrometheus();
      return toolResult({ format: "prometheus", metrics }, metrics);
    }
    logger.debug("Metrics retrieved");
    return this.deps.metrics.getMetrics();
  }

  private async serviceList(args: unknown): Promise<unknown> {
    const { sessionId } = SessionIdSchema.parse(args);
    const result = await this.deps.processService.execCommand(
      sessionId,
      "systemctl list-units --type=service --all --no-pager",
    );
    logger.info("Service list retrieved", { sessionId });
    return result;
  }

  private async serviceStatus(args: unknown): Promise<unknown> {
    const { sessionId, name } = ServiceNameSchema.parse(args);
    const result = await this.deps.processService.execCommand(
      sessionId,
      `systemctl status ${name} --no-pager`,
    );
    logger.info("Service status retrieved", { sessionId, name });
    return result;
  }

  private async serviceLogs(args: unknown): Promise<unknown> {
    const { sessionId, name, lines } = ServiceLogsSchema.parse(args);
    const result = await this.deps.processService.execCommand(
      sessionId,
      `journalctl -u ${name} -n ${lines} --no-pager`,
    );
    logger.info("Service logs retrieved", { sessionId, name, lines });
    return result;
  }

  private async serviceRestart(args: unknown): Promise<unknown> {
    const { sessionId, name } = ServiceNameSchema.parse(args);
    const result = await this.deps.processService.execCommand(
      sessionId,
      `systemctl restart ${name}`,
    );
    logger.info("Service restarted", { sessionId, name });
    return result;
  }

  private async serviceStop(args: unknown): Promise<unknown> {
    const { sessionId, name } = ServiceNameSchema.parse(args);
    const result = await this.deps.processService.execCommand(sessionId, `systemctl stop ${name}`);
    logger.info("Service stopped", { sessionId, name });
    return result;
  }

  private async diskUsage(args: unknown): Promise<unknown> {
    const { sessionId, path } = DiskUsageSchema.parse(args);
    const command = path ? `df -h ${path}` : "df -h";
    const result = await this.deps.processService.execCommand(sessionId, command);
    logger.info("Disk usage retrieved", { sessionId });
    return result;
  }

  private async memoryInfo(args: unknown): Promise<unknown> {
    const { sessionId } = SessionIdSchema.parse(args);
    const result = await this.deps.processService.execCommand(sessionId, "free -h");
    logger.info("Memory info retrieved", { sessionId });
    return result;
  }

  private async cpuUsage(args: unknown): Promise<unknown> {
    const { sessionId } = SessionIdSchema.parse(args);
    const result = await this.deps.processService.execCommand(sessionId, "uptime");
    logger.info("CPU usage retrieved", { sessionId });
    return result;
  }

  private async netInterfaces(args: unknown): Promise<unknown> {
    const { sessionId } = SessionIdSchema.parse(args);
    const result = await this.deps.processService.execCommand(sessionId, "ip addr show");
    logger.info("Network interfaces retrieved", { sessionId });
    return result;
  }

  private async portCheck(args: unknown): Promise<unknown> {
    const { sessionId, port } = PortCheckSchema.parse(args);
    const result = await this.deps.processService.execCommand(
      sessionId,
      `ss -tlnp | grep :${port} || true`,
    );
    logger.info("Port check completed", { sessionId, port });
    return result;
  }

  private async logTail(args: unknown): Promise<unknown> {
    const { sessionId, path, service, lines } = LogTailSchema.parse(args);
    let command: string;
    if (service) {
      command = `journalctl -u ${service} -n ${lines} --no-pager`;
    } else if (path) {
      command = `tail -n ${lines} ${path}`;
    } else {
      command = `journalctl -n ${lines} --no-pager`;
    }
    const result = await this.deps.processService.execCommand(sessionId, command);
    logger.info("Log tail retrieved", { sessionId, service, path, lines });
    return result;
  }
}
