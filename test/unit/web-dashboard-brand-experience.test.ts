import { describe, expect, test } from "vitest";
import { Script } from "node:vm";
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
      const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
      expect(script).toBeTruthy();
      expect(() => new Script(script!)).not.toThrow();
    }
  });

  test("uses the supplied SSH icon and a consistent product identity", () => {
    const html = markup();
    expect(html).toContain("<title>SSH MCP Pro");
    expect(html).toContain('src="/brand/ssh-mcp-pro-icon.png"');
    expect(html).toContain('alt="SSH MCP Pro"');
    expect(html).toContain('rel="icon"');
    expect(html).not.toMatch(/SSH Automator|SSH Automater|ssh-automator/iu);
  });

  test("offers task-first entry and real destinations in the workspace", () => {
    const html = markup();
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).toContain('class="workspace-shell"');
    expect(html).toContain("Connect a device");
    expect(html).toContain("Connect an AI app");
    expect(html).toContain("You're ready to work");
    expect(html).toContain("Open activity");
    expect(html).toContain("navItem('usage', '▥', 'Usage & Users')");
    expect(html).toContain("Advanced device controls");
  });

  test("guides device enrollment by operating system instead of mixing commands", () => {
    const html = markup();
    expect(html).toContain('aria-label="Choose device operating system"');
    expect(html).toContain('data-install-os="windows"');
    expect(html).toContain('data-install-os="linux"');
    expect(html).toContain('data-install-os="macos"');
    expect(html).toContain('data-os-section="windows"');
    expect(html).toContain('data-os-section="linux"');
  });

  test("uses a responsive sidebar, accessible focus and reduced-motion styles", () => {
    const html = markup();
    expect(html).toContain(".workspace-sidebar");
    expect(html).toContain("@media (max-width: 860px)");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain(":focus-visible");
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
