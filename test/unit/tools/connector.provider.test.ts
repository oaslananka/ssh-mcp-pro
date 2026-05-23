import { describe, expect, test } from "@jest/globals";
import { createTestContainer } from "../../../src/container.js";
import { ConnectorToolProvider } from "../../../src/tools/connector.provider.js";

async function destroyContainer(container: ReturnType<typeof createTestContainer>): Promise<void> {
  container.rateLimiter.destroy();
  await container.sessionManager.destroy();
}

describe("ConnectorToolProvider", () => {
  test("exposes only remote-safe schemas without credential fields", async () => {
    const container = createTestContainer();
    const provider = new ConnectorToolProvider({
      sessionManager: container.sessionManager,
      metrics: container.metrics,
      policy: container.policy,
      config: {
        ...container.config.getAll(),
        connector: {
          toolProfile: "remote-readonly",
          credentialProvider: "none",
          credentialCommandArgs: [],
          credentialCommandTimeoutMs: 5000,
        },
        policy: {
          ...container.config.get("policy"),
          allowedHosts: ["prod"],
        },
      },
    });

    const serialized = JSON.stringify(provider.getTools());

    expect(provider.getTools().map((tool) => tool.name)).toEqual([
      "connector_status",
      "ssh_hosts_list",
      "ssh_policy_explain",
      "ssh_host_inspect",
      "ssh_mutation_plan",
    ]);
    expect(serialized).not.toMatch(/password|privateKey|privateKeyPath|passphrase|sudoPassword/);

    await destroyContainer(container);
  });

  test("reports connector readiness without secrets", async () => {
    const container = createTestContainer();
    const provider = new ConnectorToolProvider({
      sessionManager: container.sessionManager,
      metrics: container.metrics,
      policy: container.policy,
      config: {
        ...container.config.getAll(),
        connector: {
          toolProfile: "remote-broker",
          credentialProvider: "agent",
          credentialCommandArgs: [],
          credentialCommandTimeoutMs: 5000,
        },
        policy: {
          ...container.config.get("policy"),
          allowedHosts: ["prod"],
        },
      },
    });

    await expect(provider.handleTool("connector_status", {})).resolves.toEqual(
      expect.objectContaining({
        toolProfile: "remote-broker",
        credentialProvider: "agent",
        credentialEntryInChat: false,
        privateKeysInChat: false,
      }),
    );

    await destroyContainer(container);
  });

  test("mutation plans are non-executing and require confirmation", async () => {
    const container = createTestContainer();
    const provider = new ConnectorToolProvider({
      sessionManager: container.sessionManager,
      metrics: container.metrics,
      policy: container.policy,
      config: container.config.getAll(),
    });

    await expect(
      provider.handleTool("ssh_mutation_plan", {
        hostAlias: "prod",
        goal: "restart nginx",
        category: "service",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        executed: false,
        requiredBeforeExecution: expect.arrayContaining([
          "policy explicitly allows the concrete operation",
          "user reviews and confirms the concrete tool payload",
        ]),
      }),
    );

    await destroyContainer(container);
  });

  test("host inspection fails closed when no credential provider is configured", async () => {
    const container = createTestContainer();
    const provider = new ConnectorToolProvider({
      sessionManager: container.sessionManager,
      metrics: container.metrics,
      policy: container.policy,
      config: container.config.getAll(),
    });

    await expect(
      provider.handleTool("ssh_host_inspect", {
        hostAlias: "prod",
        checks: ["os"],
      }),
    ).rejects.toThrow("credential provider is not configured");

    await destroyContainer(container);
  });
});
