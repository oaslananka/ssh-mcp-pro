import { logger } from "./logging.js";

/**
 * Metrics data structure
 */
export interface Metrics {
  sessions: {
    created: number;
    closed: number;
    active: number;
    errors: number;
  };
  commands: {
    executed: number;
    successful: number;
    failed: number;
    totalDurationMs: number;
    avgDurationMs: number;
  };
  files: {
    reads: number;
    writes: number;
    deletes: number;
    bytesRead: number;
    bytesWritten: number;
  };
  transfers: {
    uploads: number;
    downloads: number;
    bytesUploaded: number;
    bytesDownloaded: number;
  };
  tunnels: {
    opened: number;
    closed: number;
    active: number;
    errors: number;
  };
  policy: {
    allowed: number;
    denied: number;
    explainOnly: number;
  };
  uptime: number;
  startedAt: number;
}

/**
 * Metrics collector for monitoring and observability
 */
export class MetricsCollector {
  private metrics: Metrics;

  constructor() {
    this.metrics = this.createEmptyMetrics();
  }

  private createEmptyMetrics(): Metrics {
    return {
      sessions: { created: 0, closed: 0, active: 0, errors: 0 },
      commands: {
        executed: 0,
        successful: 0,
        failed: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      },
      files: { reads: 0, writes: 0, deletes: 0, bytesRead: 0, bytesWritten: 0 },
      transfers: { uploads: 0, downloads: 0, bytesUploaded: 0, bytesDownloaded: 0 },
      tunnels: { opened: 0, closed: 0, active: 0, errors: 0 },
      policy: { allowed: 0, denied: 0, explainOnly: 0 },
      uptime: 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Record session creation
   */
  recordSessionCreated(): void {
    this.metrics.sessions.created++;
    this.metrics.sessions.active++;
    logger.debug("Metrics: session created", {
      active: this.metrics.sessions.active,
    });
  }

  /**
   * Record session closed
   */
  recordSessionClosed(): void {
    this.metrics.sessions.closed++;
    this.metrics.sessions.active = Math.max(0, this.metrics.sessions.active - 1);
    logger.debug("Metrics: session closed", {
      active: this.metrics.sessions.active,
    });
  }

  /**
   * Record session error
   */
  recordSessionError(): void {
    this.metrics.sessions.errors++;
  }

  /**
   * Record command execution
   */
  recordCommand(durationMs: number, success: boolean): void {
    this.metrics.commands.executed++;
    this.metrics.commands.totalDurationMs += durationMs;
    this.metrics.commands.avgDurationMs =
      this.metrics.commands.totalDurationMs / this.metrics.commands.executed;

    if (success) {
      this.metrics.commands.successful++;
    } else {
      this.metrics.commands.failed++;
    }
  }

  /**
   * Record file read
   */
  recordFileRead(bytes: number): void {
    this.metrics.files.reads++;
    this.metrics.files.bytesRead += bytes;
  }

  /**
   * Record file write
   */
  recordFileWrite(bytes: number): void {
    this.metrics.files.writes++;
    this.metrics.files.bytesWritten += bytes;
  }

  recordFileDelete(): void {
    this.metrics.files.deletes++;
  }

  recordTransfer(kind: "upload" | "download", bytes: number): void {
    if (kind === "upload") {
      this.metrics.transfers.uploads++;
      this.metrics.transfers.bytesUploaded += bytes;
      return;
    }

    this.metrics.transfers.downloads++;
    this.metrics.transfers.bytesDownloaded += bytes;
  }

  recordTunnelOpened(): void {
    this.metrics.tunnels.opened++;
    this.metrics.tunnels.active++;
  }

  recordTunnelClosed(): void {
    this.metrics.tunnels.closed++;
    this.metrics.tunnels.active = Math.max(0, this.metrics.tunnels.active - 1);
  }

  recordTunnelError(): void {
    this.metrics.tunnels.errors++;
  }

  recordPolicyDecision(allowed: boolean, mode: "enforce" | "explain"): void {
    if (mode === "explain") {
      this.metrics.policy.explainOnly++;
      return;
    }

    if (allowed) {
      this.metrics.policy.allowed++;
    } else {
      this.metrics.policy.denied++;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): Metrics {
    return {
      ...this.metrics,
      sessions: { ...this.metrics.sessions },
      commands: { ...this.metrics.commands },
      files: { ...this.metrics.files },
      transfers: { ...this.metrics.transfers },
      tunnels: { ...this.metrics.tunnels },
      policy: { ...this.metrics.policy },
      uptime: Date.now() - this.metrics.startedAt,
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const m = this.getMetrics();
    const lines: string[] = [
      "# HELP ssh_mcp_sessions_total Total number of SSH sessions",
      "# TYPE ssh_mcp_sessions_total counter",
      `ssh_mcp_sessions_created ${m.sessions.created}`,
      `ssh_mcp_sessions_closed ${m.sessions.closed}`,
      `ssh_mcp_sessions_errors ${m.sessions.errors}`,
      "",
      "# HELP ssh_mcp_sessions_active Current active sessions",
      "# TYPE ssh_mcp_sessions_active gauge",
      `ssh_mcp_sessions_active ${m.sessions.active}`,
      "",
      "# HELP ssh_mcp_commands_total Total number of commands executed",
      "# TYPE ssh_mcp_commands_total counter",
      `ssh_mcp_commands_executed ${m.commands.executed}`,
      `ssh_mcp_commands_successful ${m.commands.successful}`,
      `ssh_mcp_commands_failed ${m.commands.failed}`,
      "",
      "# HELP ssh_mcp_command_duration_ms Average command duration",
      "# TYPE ssh_mcp_command_duration_ms gauge",
      `ssh_mcp_command_duration_avg_ms ${m.commands.avgDurationMs.toFixed(2)}`,
      "",
      "# HELP ssh_mcp_files_total File operations",
      "# TYPE ssh_mcp_files_total counter",
      `ssh_mcp_files_reads ${m.files.reads}`,
      `ssh_mcp_files_writes ${m.files.writes}`,
      `ssh_mcp_files_deletes ${m.files.deletes}`,
      `ssh_mcp_files_bytes_read ${m.files.bytesRead}`,
      `ssh_mcp_files_bytes_written ${m.files.bytesWritten}`,
      "",
      "# HELP ssh_mcp_transfers_total File transfer operations",
      "# TYPE ssh_mcp_transfers_total counter",
      `ssh_mcp_transfers_uploads ${m.transfers.uploads}`,
      `ssh_mcp_transfers_downloads ${m.transfers.downloads}`,
      `ssh_mcp_transfers_bytes_uploaded ${m.transfers.bytesUploaded}`,
      `ssh_mcp_transfers_bytes_downloaded ${m.transfers.bytesDownloaded}`,
      "",
      "# HELP ssh_mcp_tunnels_total SSH tunnel lifecycle events",
      "# TYPE ssh_mcp_tunnels_total counter",
      `ssh_mcp_tunnels_opened ${m.tunnels.opened}`,
      `ssh_mcp_tunnels_closed ${m.tunnels.closed}`,
      `ssh_mcp_tunnels_errors ${m.tunnels.errors}`,
      "",
      "# HELP ssh_mcp_tunnels_active Active SSH tunnels",
      "# TYPE ssh_mcp_tunnels_active gauge",
      `ssh_mcp_tunnels_active ${m.tunnels.active}`,
      "",
      "# HELP ssh_mcp_policy_decisions_total Policy decisions",
      "# TYPE ssh_mcp_policy_decisions_total counter",
      `ssh_mcp_policy_allowed ${m.policy.allowed}`,
      `ssh_mcp_policy_denied ${m.policy.denied}`,
      `ssh_mcp_policy_explain_only ${m.policy.explainOnly}`,
      "",
      "# HELP ssh_mcp_uptime_ms Server uptime in milliseconds",
      "# TYPE ssh_mcp_uptime_ms gauge",
      `ssh_mcp_uptime_ms ${m.uptime}`,
    ];

    return lines.join("\n");
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = this.createEmptyMetrics();
    logger.info("Metrics reset");
  }
}
