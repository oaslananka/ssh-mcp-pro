import vm from "node:vm";
import { describe, expect, test } from "vitest";
import { sanitizeAgent } from "../../src/remote/http-util.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { renderDashboardHtml } from "../../src/remote/web-dashboard-html.js";
import type { RemoteAgentRecord } from "../../src/remote/types.js";

describe("dashboard device host metadata", () => {
  test("renders the snake_case API contract without Unknown or undefined labels", () => {
    const policy = createAgentPolicy("full-admin");
    const agent: RemoteAgentRecord = {
      id: "agt_fixture",
      userId: "google:fixture",
      alias: "msi",
      status: "online",
      profile: policy.profile,
      policy,
      policyVersion: policy.version,
      hostMetadata: { hostname: "msi", os: "Linux", arch: "x64", platform: "linux" },
      createdAt: "2026-11-06T00:00:00Z",
      updatedAt: "2026-11-06T00:00:00Z",
    };
    const response = { ...sanitizeAgent(agent), isLiveConnected: true };
    expect(response).toHaveProperty("host_metadata.hostname", "msi");
    expect(response).toHaveProperty("policy_version", 1);

    const markup = renderDashboardHtml(
      Buffer.from(
        JSON.stringify({ id: "google:fixture", displayName: "Test owner", provider: "google" }),
      ).toString("base64"),
      JSON.stringify("https://mcp.example.invalid/mcp"),
      JSON.stringify("https://mcp.example.invalid"),
    );
    // This fixture is the app's own constant HTML, not input to an HTML sanitizer.
    const start = markup.indexOf("<script>");
    const end = markup.indexOf("</script>", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const clientScript = markup.slice(start + "<script>".length, end);
    const nodes: Record<string, { innerHTML: string }> = {};
    const document = {
      getElementById: (id: string) => {
        nodes[id] ??= { innerHTML: "" };
        return nodes[id];
      },
    };
    const context = vm.createContext({ atob, document });
    vm.runInContext(clientScript, context, { timeout: 800 });
    vm.runInContext(
      "devicesList = [" +
        JSON.stringify(response) +
        "]; activeTab = 'devices'; " +
        "document.getElementById('tabContent').innerHTML = renderTabContent();",
      context,
      { timeout: 800 },
    );
    const html = nodes["tabContent"]?.innerHTML ?? "";
    expect(html).toContain("Host: msi");
    expect(html).toContain("OS: Linux");
    expect(html).toContain("Arch: x64");
    expect(html).toContain("Policy v1");
    expect(html).not.toContain("Unknown");
    expect(html).not.toContain("undefined");
  });
});
