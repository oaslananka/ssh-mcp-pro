import { describe, expect, test } from "vitest";
import { Script } from "node:vm";
import { parse as parseHtml } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderDashboardHtml } from "../../src/remote/web-dashboard-html.js";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { captureResponse, request, testConfig } from "../helpers/web-dashboard-fixture.js";
import type { ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const markup = () =>
  renderDashboardHtml(
    Buffer.from(
      JSON.stringify({
        id: "github:1",
        displayName: "Test Operator",
        provider: "github",
        serviceOwner: true,
      }),
    ).toString("base64"),
    JSON.stringify("https://example.test/mcp"),
    JSON.stringify("https://example.test"),
  );

type HtmlNode = DefaultTreeAdapterMap["node"];

function extractBrowserScript(html: string): string {
  const visit = (node: HtmlNode): string | undefined => {
    if ("tagName" in node && node.tagName === "script") {
      const text = node.childNodes.find((child) => child.nodeName === "#text");
      if (text && "value" in text) return text.value;
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) {
        const result = visit(child);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  };
  const script = visit(parseHtml(html));
  if (script === undefined) throw new Error("Dashboard browser script is missing");
  return script;
}

async function renderWithUnavailableApi(tab: "devices" | "audit") {
  const elements = new Map<string, { innerHTML: string }>();
  const context = {
    atob,
    console: { error() {} },
    document: {
      body: { classList: { toggle() {} } },
      getElementById(id: string) {
        if (!elements.has(id)) elements.set(id, { innerHTML: "" });
        return elements.get(id)!;
      },
      querySelector: () => null,
    },
    fetch: async () => ({ ok: false, status: 503 }),
  };
  new Script(extractBrowserScript(markup())).runInNewContext(context);
  if (tab === "audit") new Script("switchTab('audit')").runInNewContext(context);
  await new Promise((resolve) => setImmediate(resolve));
  return elements;
}

describe("SSH MCP Pro brand and first-use journey", () => {
  test("the supplied product icon remains byte-identical", () => {
    const icon = readFileSync(new URL("../../assets/ssh-mcp-pro-icon.png", import.meta.url));
    expect(createHash("sha256").update(icon).digest("hex")).toBe(
      "2ce10de7c6d2c2e21aa1f813e43a27bd7aaf2b35f11acbde4476dd2fbbefab1f",
    );
  });

  test("the browser script is syntactically valid in both signed-out and signed-in states", () => {
    for (const html of [
      renderDashboardHtml(
        Buffer.from("null").toString("base64"),
        JSON.stringify("https://example.test/mcp"),
        JSON.stringify("https://example.test"),
      ),
      markup(),
    ]) {
      expect(() => new Script(extractBrowserScript(html))).not.toThrow();
    }
  });

  test.each([
    {
      area: "SSH MCP Pro identity",
      markers: [
        "<title>SSH MCP Pro",
        'src="/brand/ssh-mcp-pro-icon.png"',
        'alt="SSH MCP Pro"',
        'rel="icon"',
      ],
    },
    {
      area: "task-first workspace navigation",
      markers: [
        'aria-label="Workspace navigation"',
        'class="workspace-shell"',
        "Connect a device",
        "Connect an AI app",
        "You're ready to work",
        "Open activity",
        "navItem('usage', '▥', 'Usage & Users')",
        "Advanced device controls",
      ],
    },
    {
      area: "operating-system-specific enrollment",
      markers: [
        'aria-label="Choose device operating system"',
        'data-install-os="windows"',
        'data-install-os="linux"',
        'data-install-os="macos"',
        'data-os-section="windows"',
        'data-os-section="linux"',
      ],
    },
    {
      area: "responsive and accessible presentation",
      markers: [
        ".workspace-sidebar",
        "@media (max-width: 860px)",
        "prefers-reduced-motion",
        ":focus-visible",
      ],
    },
  ])("renders $area", ({ markers }) => {
    const html = markup();
    for (const marker of markers) expect(html).toContain(marker);
  });

  test("does not expose any outdated SSH Automator identity", () => {
    const html = markup();
    for (const oldName of ["SSH Automator", "SSH Automater", "ssh-automator"]) {
      expect(html).not.toContain(oldName);
    }
  });

  test("recovers from unavailable devices API with a working retry action", async () => {
    const elements = await renderWithUnavailableApi("devices");
    const body = elements.get("appRoot")?.innerHTML ?? "";
    expect(body).toContain("Could not load your devices");
    expect(body).toContain('onclick="retryDevices()"');
    expect(body).not.toContain("Loading your connected devices…");
  });

  test("shows retry instead of a false empty state when activity API fails", async () => {
    const elements = await renderWithUnavailableApi("audit");
    const panel = elements.get("tabContent")?.innerHTML ?? "";
    expect(panel).toContain("Could not load activity");
    expect(panel).toContain('onclick="loadAudit()"');
    expect(panel).not.toContain("No audit events recorded yet.");
  });

  test("serves the exact supplied PNG as a versioned public brand asset", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brand-assets-"));
    const plane = new RemoteControlPlane(testConfig(dir));
    await plane.initialize();
    try {
      const response = captureResponse();
      const handled = await plane.handleHttp(
        request("GET", "/brand/ssh-mcp-pro-icon.png"),
        response as unknown as ServerResponse,
        "/brand/ssh-mcp-pro-icon.png",
      );
      expect(handled).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.getHeader("content-type")).toContain("image/png");
      expect(response.getHeader("x-content-type-options")).toBe("nosniff");
    } finally {
      plane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
