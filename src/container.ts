import { ConfigManager, type ServerConfig } from "./config.js";
import { AuditLog } from "./audit.js";
import { MetricsCollector } from "./metrics.js";
import { PolicyEngine } from "./policy.js";
import { RateLimiter } from "./rate-limiter.js";
import { SessionManager } from "./session.js";
import { createTunnelService, type TunnelService } from "./tunnel.js";

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

export interface AppContainer {
  config: ConfigManager;
  rateLimiter: RateLimiter;
  metrics: MetricsCollector;
  auditLog: AuditLog;
  policy: PolicyEngine;
  sessionManager: SessionManager;
  tunnelService: TunnelService;
}

export function createContainer(configOverrides: Partial<ServerConfig> = {}): AppContainer {
  const config = new ConfigManager(configOverrides);
  const rateLimiter = new RateLimiter({
    maxRequests: config.get("rateLimit").maxRequests,
    windowMs: config.get("rateLimit").windowMs,
    blockOnLimit: true,
  });
  const metrics = new MetricsCollector();
  const auditLog = new AuditLog();
  const policy = new PolicyEngine(config.get("policy"), (decision, context) => {
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
  const sessionManager = new SessionManager(
    config.get("maxSessions"),
    config.get("sessionTtlMs"),
    config.get("cleanupIntervalMs"),
    config.get("security"),
    policy,
  );
  const tunnelService = createTunnelService({
    sessionManager,
    metrics,
    policy,
  });
  sessionManager.onSessionClose(async (sessionId) => {
    await tunnelService.closeSessionTunnels(sessionId);
  });

  return {
    config,
    rateLimiter,
    metrics,
    auditLog,
    policy,
    sessionManager,
    tunnelService,
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
