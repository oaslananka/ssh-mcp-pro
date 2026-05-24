import { vi } from "vitest";
import { AuditLog } from "../../src/audit.js";
import { ConfigManager } from "../../src/config.js";
import type { AppContainer } from "../../src/container.js";
import { MetricsCollector } from "../../src/metrics.js";
import { PolicyEngine, type PolicyContext, type PolicyDecision } from "../../src/policy.js";
import { RateLimiter } from "../../src/rate-limiter.js";
import { SessionManager } from "../../src/session.js";
import { createTunnelService } from "../../src/tunnel.js";

export const AGENT_ENROLL_COMMAND =
  "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll";
export const AGENT_RUN_COMMAND = "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run";
export const LEGACY_AGENT_COMMAND_PATTERN = /npx ssh-mcp-pro agent|sshautomator-agent/u;

export function createAllowPolicy() {
  return {
    assertAllowed: vi.fn(
      (context: PolicyContext): PolicyDecision => ({
        allowed: true,
        mode: context.mode ?? "enforce",
        action: context.action,
      }),
    ),
  };
}

export function createTestConfig() {
  return {
    commandTimeoutMs: 30000,
    maxCommandOutputBytes: 1024 * 1024,
    maxStreamChunks: 4096,
    maxFileSize: 1024 * 1024,
    maxFileWriteBytes: 1024 * 1024,
    maxTransferBytes: 50 * 1024 * 1024,
  };
}

export function createFileMetrics() {
  return {
    recordFileRead: vi.fn(),
    recordFileWrite: vi.fn(),
    recordFileDelete: vi.fn(),
  };
}

export function createTransferMetrics() {
  return {
    recordTransfer: vi.fn(),
  };
}

export function createTunnelMetrics() {
  return {
    recordTunnelOpened: vi.fn(),
    recordTunnelClosed: vi.fn(),
    recordTunnelError: vi.fn(),
  };
}

export function createSessionInfo(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    host: "example.com",
    port: 22,
    username: "demo",
    connected: true,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    sftpAvailable: true,
    policyMode: "enforce",
    hostKeyPolicy: "insecure",
    ...overrides,
  };
}

export type FileMetrics = Pick<
  MetricsCollector,
  "recordFileRead" | "recordFileWrite" | "recordFileDelete"
>;

function auditDetails(
  action: string,
  values: {
    host?: string | undefined;
    username?: string | undefined;
    target?: string | undefined;
  },
) {
  return {
    action,
    ...(values.host ? { host: values.host } : {}),
    ...(values.username ? { username: values.username } : {}),
    ...(values.target ? { target: values.target } : {}),
  };
}

export function createTestContainer(overrides: Partial<AppContainer> = {}): AppContainer {
  const config =
    overrides.config ??
    new ConfigManager({
      maxSessions: 5,
      sessionTtlMs: 5_000,
      cleanupIntervalMs: 60_000,
      rateLimit: {
        enabled: false,
        maxRequests: 1_000,
        perSession: {
          enabled: true,
          maxRequests: 50,
          windowMs: 60_000,
        },
        windowMs: 60_000,
      },
    });

  const metrics = overrides.metrics ?? new MetricsCollector();
  const auditLog = overrides.auditLog ?? new AuditLog();
  const policy =
    overrides.policy ??
    new PolicyEngine(config.get("policy"), (decision, context) => {
      metrics.recordPolicyDecision(decision.allowed, decision.mode);
      auditLog.recordPolicyDecision(
        decision,
        auditDetails(context.action, {
          host: context.host,
          username: context.username,
          target: context.path ?? context.command,
        }),
      );
    });

  const sessionManager =
    overrides.sessionManager ??
    new SessionManager(
      config.get("maxSessions"),
      config.get("sessionTtlMs"),
      config.get("cleanupIntervalMs"),
      config.get("security"),
      policy,
    );
  const tunnelService =
    overrides.tunnelService ??
    createTunnelService({
      sessionManager,
      metrics,
      policy,
    });
  if (!overrides.tunnelService) {
    sessionManager.onSessionClose(async (sessionId) => {
      await tunnelService.closeSessionTunnels(sessionId);
    });
  }

  return {
    config,
    rateLimiter:
      overrides.rateLimiter ??
      new RateLimiter({
        maxRequests: config.get("rateLimit").maxRequests,
        windowMs: config.get("rateLimit").windowMs,
        blockOnLimit: false,
      }),
    metrics,
    auditLog,
    policy,
    sessionManager,
    tunnelService,
  };
}
