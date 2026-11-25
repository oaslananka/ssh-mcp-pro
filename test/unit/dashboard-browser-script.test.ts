import { describe, expect, test } from "vitest";
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { Script } from "node:vm";
import { renderDashboardHtml } from "../../src/remote/web-dashboard-html.js";
import { DASHBOARD_PAGE_RENDER_SCRIPT } from "../../src/remote/web-dashboard-page-render-script.js";
import { DASHBOARD_AI_CLIENT_SCRIPT } from "../../src/remote/web-dashboard-ai-client-script.js";
import { DASHBOARD_BRAND_FINGERPRINT } from "../../src/remote/web-dashboard-brand.js";

type HtmlNode = DefaultTreeAdapterMap["node"];

function findScript(node: HtmlNode): string | undefined {
  if ("tagName" in node && node.tagName === "script") {
    const child = node.childNodes.find((item) => item.nodeName === "#text");
    if (child && "value" in child) return child.value;
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      const result = findScript(child);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}

describe("dashboard browser script composition", () => {
  test("preserves page rendering, AI client functions, brand fingerprint and script order", () => {
    const html = renderDashboardHtml(
      Buffer.from(JSON.stringify(null)).toString("base64"),
      JSON.stringify("https://example.test/mcp"),
      JSON.stringify("https://example.test"),
    );
    const script = findScript(parse(html));
    expect(script).toBeDefined();
    const text = script!;
    expect(DASHBOARD_PAGE_RENDER_SCRIPT).toContain("function renderLanding()");
    expect(DASHBOARD_PAGE_RENDER_SCRIPT).toContain("function renderTabContent()");
    expect(DASHBOARD_PAGE_RENDER_SCRIPT).toContain(DASHBOARD_BRAND_FINGERPRINT);
    expect(DASHBOARD_AI_CLIENT_SCRIPT).toContain("function renderAiConnectionCards()");
    expect(DASHBOARD_AI_CLIENT_SCRIPT).toContain("async function revokeAiClient(");
    expect(text.split(DASHBOARD_PAGE_RENDER_SCRIPT)).toHaveLength(2);
    expect(text.split(DASHBOARD_AI_CLIENT_SCRIPT)).toHaveLength(2);
    const pageStart = text.indexOf(DASHBOARD_PAGE_RENDER_SCRIPT);
    const aiStart = text.indexOf(DASHBOARD_AI_CLIENT_SCRIPT);
    expect(pageStart).toBeGreaterThan(text.indexOf("function switchTab("));
    expect(pageStart + DASHBOARD_PAGE_RENDER_SCRIPT.length).toBe(aiStart);
    expect(aiStart + DASHBOARD_AI_CLIENT_SCRIPT.length).toBe(
      text.indexOf("    function renderUsagePanel()"),
    );
    expect(() => new Script(text)).not.toThrow();
  });
});
