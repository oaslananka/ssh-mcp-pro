import { afterAll, describe, expect, test } from "vitest";
import type { AppContainer } from "../../src/container.js";
import { createTestContainer } from "./helpers.js";
import { listResources, readResource } from "../../src/resources.js";

const CANONICAL_RESOURCE_URIS = [
  "ssh-mcp-pro://sessions/active",
  "ssh-mcp-pro://metrics/json",
  "ssh-mcp-pro://metrics/prometheus",
  "ssh-mcp-pro://ssh-config/hosts",
  "ssh-mcp-pro://policy/effective",
  "ssh-mcp-pro://audit/recent",
  "ssh-mcp-pro://capabilities/support-matrix",
] as const;

const RENAME_ERA_RESOURCE_URIS = CANONICAL_RESOURCE_URIS.map((uri) =>
  uri.replace("ssh-mcp-pro://", "mcp-ssh-tool://"),
);

async function destroyContainer(container: AppContainer): Promise<void> {
  container.rateLimiter.destroy();
  await container.sessionManager.destroy();
}

describe("resource helpers", () => {
  const container = createTestContainer();

  afterAll(async () => {
    await destroyContainer(container);
  });

  test("lists the built-in MCP resources", () => {
    const result = listResources();
    const uris = result.resources.map((resource) => resource.uri);

    expect(uris).toEqual([...CANONICAL_RESOURCE_URIS]);
  });

  test("reads session and metrics resources", async () => {
    const sessions = await readResource("ssh-mcp-pro://sessions/active", container);
    const metrics = await readResource("ssh-mcp-pro://metrics/json", container);
    const prometheus = await readResource("ssh-mcp-pro://metrics/prometheus", container);

    expect(sessions.contents[0]?.uri).toBe("ssh-mcp-pro://sessions/active");
    expect(JSON.parse(sessions.contents[0]?.text ?? "null")).toEqual([]);
    expect(metrics.contents[0]?.uri).toBe("ssh-mcp-pro://metrics/json");
    expect(JSON.parse(metrics.contents[0]?.text ?? "{}")).toEqual(
      expect.objectContaining({
        sessions: expect.any(Object),
        commands: expect.any(Object),
      }),
    );
    expect(prometheus.contents[0]?.uri).toBe("ssh-mcp-pro://metrics/prometheus");
    expect(prometheus.contents[0]?.text).toContain("ssh_mcp_sessions_created");
  });

  test("does not retain rename-era resource URI aliases", async () => {
    const listedUris = listResources().resources.map((resource) => resource.uri);

    for (const uri of RENAME_ERA_RESOURCE_URIS) {
      expect(listedUris).not.toContain(uri);
      await expect(readResource(uri, container)).rejects.toThrow(`Unknown resource: ${uri}`);
    }
  });

  test("reads v2 policy, audit, and support matrix resources", async () => {
    const policy = await readResource("ssh-mcp-pro://policy/effective", container);
    const audit = await readResource("ssh-mcp-pro://audit/recent", container);
    const support = await readResource("ssh-mcp-pro://capabilities/support-matrix", container);

    expect(JSON.parse(policy.contents[0]?.text ?? "{}")).toEqual(
      expect.objectContaining({
        mode: "enforce",
        allowRawSudo: false,
      }),
    );
    expect(JSON.parse(audit.contents[0]?.text ?? "{}")).toEqual(
      expect.objectContaining({
        events: expect.any(Array),
      }),
    );
    expect(support.contents[0]?.text).toContain("BusyBox/dropbear");
  });

  test("reads configured SSH hosts as JSON", async () => {
    const hostsResource = await readResource("ssh-mcp-pro://ssh-config/hosts", container);
    const payload = JSON.parse(hostsResource.contents[0]?.text ?? "{}") as {
      hosts?: unknown;
    };

    expect(Array.isArray(payload.hosts)).toBe(true);
  });

  test("throws for unknown resources", async () => {
    await expect(readResource("ssh-mcp-pro://missing", container)).rejects.toThrow(
      "Unknown resource",
    );
  });
});
