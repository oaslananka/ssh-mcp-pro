import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("Cross-platform MCP app identity", () => {
  test("prepares exactly five safe positive and three negative MCP review cases", () => {
    const path = fileURLToPath(
      new URL("../../apps/chatgpt/review-test-cases.json", import.meta.url),
    );
    const cases = JSON.parse(readFileSync(path, "utf8"));
    expect(cases.positive).toHaveLength(5);
    expect(cases.negative).toHaveLength(3);
    const manifestPath = fileURLToPath(
      new URL("../../apps/chatgpt/app-readiness.json", import.meta.url),
    );
    const profile = JSON.parse(readFileSync(manifestPath, "utf8")).toolProfiles[0];
    for (const c of cases.positive) {
      expect(c.prompt).toBeTruthy();
      expect(c.expected_behavior).toBeTruthy();
      expect(c.tools_triggered.length).toBeGreaterThan(0);
      for (const tool of c.tools_triggered) expect(profile.tools).toContain(tool);
    }
    for (const c of cases.negative) {
      expect(c.prompt).toBeTruthy();
      expect(c.expected_behavior).toBeTruthy();
    }
  });

  test("ships a portable ChatGPT MCP plugin with the canonical name and DCR", () => {
    const base = new URL("../../apps/chatgpt/plugin/", import.meta.url);
    const plugin = JSON.parse(readFileSync(fileURLToPath(new URL("plugin.json", base)), "utf8"));
    const mcp = JSON.parse(readFileSync(fileURLToPath(new URL("mcp.json", base)), "utf8"));
    expect(plugin.name).toBe("ssh-mcp-pro");
    expect(plugin.extensions["com.openai"].interface.displayName).toBe("ssh-mcp-pro");
    const interfaceMetadata = plugin.extensions["com.openai"].interface;
    expect(interfaceMetadata.shortDescription.length).toBeLessThanOrEqual(30);
    expect(interfaceMetadata.shortDescription).toBe("Inspect SSH devices safely");
    expect(interfaceMetadata.supportURL).toBe("https://ssh-mcp-pro.oaslananka.dev/support");
    expect(interfaceMetadata.category).toBe("Developer Tools");
    const cases = plugin.extensions["com.openai"].review.test_cases;
    expect(cases.positive).toHaveLength(5);
    expect(cases.negative).toHaveLength(3);
    for (const positive of cases.positive) {
      expect(positive.tools_triggered).toBeTypeOf("string");
      expect(positive.expected_behavior).toBeTruthy();
    }
    expect(mcp.mcpServers["ssh-mcp-pro"]).toMatchObject({
      type: "streamable-http",
      url: "https://ssh-mcp-pro.oaslananka.dev/mcp",
      extensions: { "com.openai": { auth: { type: "oauth", client: { mode: "dcr" } } } },
    });
  });

  test("installs Gemini CLI extension without relying on unbuilt GitHub dist", () => {
    const fullPath = fileURLToPath(new URL("../../gemini-extension.json", import.meta.url));
    const ext = JSON.parse(readFileSync(fullPath, "utf8"));
    expect(ext.name).toBe("ssh-mcp-pro");
    expect(ext.contextFileName).toBe("AGENTS.md");
    expect(ext.contextFiles).toBeUndefined();
    expect(ext.mcpServers["ssh-mcp-pro"]).toMatchObject({
      command: "npx",
      args: ["--yes", "ssh-mcp-pro@latest"],
    });
  });

  test.each([
    "apps/chatgpt/app-readiness.json",
    "apps/claude/connector-readiness.json",
    "apps/google/gemini-app-readiness.json",
  ])("%s presents the same ssh-mcp-pro identity and retains real submission status", (file) => {
    const fullPath = fileURLToPath(new URL("../../" + file, import.meta.url));
    const manifest = JSON.parse(readFileSync(fullPath, "utf8"));
    const displayName = manifest.app?.name ?? manifest.connector?.name;
    expect(displayName).toBe("ssh-mcp-pro");
    if (file.includes("/chatgpt/")) expect(manifest.app.icon).toBe("assets/brand/icon-512.png");
    expect(manifest.publishReady).toBe(false);
    expect(manifest.mcp.packageName).toBe("ssh-mcp-pro");
  });
});
