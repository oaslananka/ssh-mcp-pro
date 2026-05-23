import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createTestContainer } from "../../../src/container.js";

const getConfiguredHosts = jest.fn<() => Promise<string[]>>();
const resolveConnectorCredentials = jest.fn<() => Promise<any>>();

async function loadProvider() {
  return import("../../../src/tools/connector.provider.js");
}

function createProviderDeps(overrides: Record<string, unknown> = {}) {
  const container = createTestContainer();
  const explain = jest.fn((context: any) => ({
    allowed: true,
    mode: "enforce",
    action: context.action,
    context,
  }));
  const deps = {
    sessionManager: {
      openSession: jest.fn(async () => ({
        sessionId: "session-1",
        host: "prod.example",
        username: "deploy",
        sftpAvailable: true,
        expiresInMs: 1000,
      })),
      closeSession: jest.fn(async () => true),
      getOSInfo: jest.fn(async () => ({ platform: "linux" })),
      getSession: jest.fn(() => ({
        ssh: {
          execCommand: jest.fn(async (command: string) => ({
            code: command.includes("free") ? 1 : 0,
            stdout: command.includes("free") ? "x".repeat(4100) : `ok:${command}`,
            stderr: command.includes("free") ? "fallback" : "",
          })),
        },
      })),
    },
    metrics: {
      recordSessionCreated: jest.fn(),
      recordSessionClosed: jest.fn(),
    },
    policy: { explain },
    getConfiguredHosts,
    resolveConnectorCredentials,
    config: {
      ...container.config.getAll(),
      auth: {
        ...container.config.get("auth"),
        mode: "oauth",
        oauthIssuer: "https://issuer.example",
        oauthJwksUrl: "https://issuer.example/jwks.json",
      },
      connector: {
        toolProfile: "remote-broker",
        credentialProvider: "command",
        credentialCommand: "credential-helper",
        credentialCommandArgs: [],
        credentialCommandTimeoutMs: 5000,
      },
      http: {
        ...container.config.get("http"),
        allowedOrigins: ["https://chat.openai.com"],
      },
      policy: {
        ...container.config.get("policy"),
        allowedHosts: ["prod", "^prod-[0-9]+$", "["],
      },
    },
    ...overrides,
  };

  return { container, deps };
}

describe("ConnectorToolProvider coverage", () => {
  beforeEach(() => {
    jest.resetModules();
    getConfiguredHosts.mockReset();
    resolveConnectorCredentials.mockReset();
  });

  test("handles unknown tools and reports configured broker readiness", async () => {
    const { ConnectorToolProvider } = await loadProvider();
    const { container, deps } = createProviderDeps();
    const provider = new ConnectorToolProvider(deps as any);

    expect(provider.handleTool("missing_tool", {})).toBeUndefined();
    await expect(provider.handleTool("connector_status", {})).resolves.toEqual(
      expect.objectContaining({
        credentialBrokerConfigured: true,
        oauthConfigured: true,
        allowedOriginsConfigured: true,
        hostAllowlistConfigured: true,
      }),
    );

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("lists only policy-allowed host aliases and tolerates bad allow regexes", async () => {
    const { ConnectorToolProvider } = await loadProvider();
    const { container, deps } = createProviderDeps();
    getConfiguredHosts.mockResolvedValue(["prod", "prod-1", "qa"]);
    const provider = new ConnectorToolProvider(deps as any);

    await expect(provider.handleTool("ssh_hosts_list", {})).resolves.toEqual({
      count: 2,
      hosts: [
        { hostAlias: "prod", allowedByPolicy: true },
        { hostAlias: "prod-1", allowedByPolicy: true },
      ],
      redactedFields: ["username", "identityFile", "privateKeyPath", "password", "passphrase"],
      hostAllowlistRequired: true,
      hostAllowlistConfigured: true,
    });

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("explains inspect and mutation policy contexts without executing", async () => {
    const { ConnectorToolProvider } = await loadProvider();
    const { container, deps } = createProviderDeps();
    const provider = new ConnectorToolProvider(deps as any);

    await expect(provider.handleTool("ssh_policy_explain", {})).resolves.toEqual(
      expect.objectContaining({
        executed: false,
        decision: expect.objectContaining({ action: "ssh.open" }),
        requiresExplicitUserConfirmation: false,
      }),
    );

    await expect(
      provider.handleTool("ssh_policy_explain", {
        hostAlias: "prod",
        action: "destructive-mutation",
        command: " sudo reboot",
        path: "/etc/hosts",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        executed: false,
        decision: expect.objectContaining({
          action: "fs.write",
          context: expect.objectContaining({
            destructive: true,
            rawSudo: true,
            host: "prod",
            path: "/etc/hosts",
          }),
        }),
        requiresExplicitUserConfirmation: true,
      }),
    );

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test.each([
    ["package", "ensure.package", false],
    ["service", "ensure.service", false],
    ["file", "fs.write", true],
    ["tunnel", "tunnel.local", false],
    ["command", "proc.exec", true],
    ["other", "proc.exec", false],
  ])("maps %s mutation plans to %s", async (category, action, destructive) => {
    const { ConnectorToolProvider } = await loadProvider();
    const { container, deps } = createProviderDeps();
    const provider = new ConnectorToolProvider(deps as any);

    await expect(
      provider.handleTool("ssh_mutation_plan", {
        hostAlias: "prod",
        goal: "make a safe change",
        category,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        executed: false,
        category,
        policyDecision: expect.objectContaining({
          action,
          context: expect.objectContaining({ destructive }),
        }),
      }),
    );

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("inspects selected host checks and always closes the temporary session", async () => {
    const { ConnectorToolProvider } = await loadProvider();
    const { container, deps } = createProviderDeps();
    resolveConnectorCredentials.mockResolvedValue({
      host: "prod.example",
      username: "deploy",
      auth: "agent",
      hostKeyPolicy: "strict",
    });
    const provider = new ConnectorToolProvider(deps as any);

    await expect(
      provider.handleTool("ssh_host_inspect", {
        hostAlias: "prod",
        checks: ["os", "uptime", "disk", "memory"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        hostAlias: "prod",
        host: "prod.example",
        strictHostKeyVerification: true,
        inspection: expect.objectContaining({
          os: { platform: "linux" },
          uptime: expect.objectContaining({ stdout: "ok:uptime" }),
          disk: expect.objectContaining({ stdout: "ok:df -h /" }),
          memory: expect.objectContaining({ stdout: expect.stringContaining("[truncated]") }),
        }),
      }),
    );
    expect(deps.sessionManager.closeSession as any).toHaveBeenCalledWith("session-1");
    expect(deps.metrics.recordSessionCreated).toHaveBeenCalledTimes(1);
    expect(deps.metrics.recordSessionClosed).toHaveBeenCalledTimes(1);

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("fails inspection if the session expires before command checks run", async () => {
    const { ConnectorToolProvider } = await loadProvider();
    const { container, deps } = createProviderDeps({
      sessionManager: {
        openSession: jest.fn(async () => ({
          sessionId: "expired",
          host: "prod.example",
          username: "deploy",
          sftpAvailable: true,
          expiresInMs: 1000,
        })),
        closeSession: jest.fn(async () => true),
        getOSInfo: jest.fn(),
        getSession: jest.fn(() => undefined),
      },
    });
    resolveConnectorCredentials.mockResolvedValue({
      host: "prod.example",
      username: "deploy",
      auth: "agent",
      hostKeyPolicy: "accept-new",
    });
    const provider = new ConnectorToolProvider(deps as any);

    await expect(
      provider.handleTool("ssh_host_inspect", {
        hostAlias: "prod",
        checks: ["uptime"],
      }),
    ).rejects.toThrow("Inspection session expired unexpectedly.");
    expect((deps.sessionManager as any).closeSession).toHaveBeenCalledWith("expired");

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });
});
