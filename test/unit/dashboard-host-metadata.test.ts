import { describe, expect, test } from "vitest";
import { sanitizeAgent } from "../../src/remote/http-util.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { renderDashboardHtml } from "../../src/remote/web-dashboard-html.js";
import type { AgentHostMetadata, RemoteAgentRecord } from "../../src/remote/types.js";

describe("dashboard device metadata contract", () => {
  test("matches the snake_case API response for host, OS, arch and policy", () => {
    const policy = createAgentPolicy("full-admin");
    const hostMetadata: AgentHostMetadata = {
      hostname: "msi",
      os: "Linux",
      arch: "x64",
      platform: "linux",
    };
    const agent: RemoteAgentRecord = {
      id: "agt_fixture",
      userId: "google:fixture",
      alias: "msi",
      status: "online",
      profile: policy.profile,
      policy,
      policyVersion: policy.version,
      hostMetadata,
      createdAt: "2026-11-06T00:00:00Z",
      updatedAt: "2026-11-06T00:00:00Z",
    };
    const apiDevice = sanitizeAgent(agent);
    expect(apiDevice).toMatchObject({
      alias: "msi",
      policy_version: 1,
      host_metadata: hostMetadata,
    });
    expect(apiDevice).not.toHaveProperty("hostMetadata");
    expect(apiDevice).not.toHaveProperty("policyVersion");

    const markup = renderDashboardHtml(
      Buffer.from(JSON.stringify({ id: "google:fixture", provider: "google" })).toString("base64"),
      JSON.stringify("https://mcp.example.invalid/mcp"),
      JSON.stringify("https://mcp.example.invalid"),
    );
    for (const field of [
      "dev.host_metadata?.hostname",
      "dev.host_metadata?.os",
      "dev.host_metadata?.arch",
      "dev.host_metadata?.platform",
      "dev.policy_version",
    ]) {
      expect(markup).toContain(field);
    }
    expect(markup).toContain("Not reported");
    expect(markup).not.toContain("dev.hostMetadata");
    expect(markup).not.toContain("dev.policyVersion");
  });
});
