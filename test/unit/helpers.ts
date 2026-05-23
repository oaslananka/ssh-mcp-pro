import { jest } from "@jest/globals";
import type { MetricsCollector } from "../../src/metrics.js";
import type { PolicyContext, PolicyDecision } from "../../src/policy.js";

export const AGENT_ENROLL_COMMAND =
  "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll";
export const AGENT_RUN_COMMAND = "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run";
export const LEGACY_AGENT_COMMAND_PATTERN = /npx ssh-mcp-pro agent|sshautomator-agent/u;

export function createAllowPolicy() {
  return {
    assertAllowed: jest.fn(
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
    recordFileRead: jest.fn(),
    recordFileWrite: jest.fn(),
    recordFileDelete: jest.fn(),
  };
}

export function createTransferMetrics() {
  return {
    recordTransfer: jest.fn(),
  };
}

export function createTunnelMetrics() {
  return {
    recordTunnelOpened: jest.fn(),
    recordTunnelClosed: jest.fn(),
    recordTunnelError: jest.fn(),
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
