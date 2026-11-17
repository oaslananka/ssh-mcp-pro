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

  test.each([
    "apps/chatgpt/app-readiness.json",
    "apps/claude/connector-readiness.json",
    "apps/google/gemini-app-readiness.json",
  ])("%s presents the same SSH MCP Pro identity and retains real submission status", (file) => {
    const fullPath = fileURLToPath(new URL("../../" + file, import.meta.url));
    const manifest = JSON.parse(readFileSync(fullPath, "utf8"));
    const displayName = manifest.app?.name ?? manifest.connector?.name;
    expect(displayName).toBe("SSH MCP Pro");
    if (file.includes("/chatgpt/")) expect(manifest.app.icon).toBe("assets/brand/icon-512.png");
    expect(manifest.publishReady).toBe(false);
    expect(manifest.mcp.packageName).toBe("ssh-mcp-pro");
  });
});
