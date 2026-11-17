import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { parse as parseHtml } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
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

async function runDashboardFixture(
  respond: () => Promise<unknown>,
  activeTab: "devices" | "audit" | "ai-clients" = "devices",
) {
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
    fetch: respond,
  };
  new Script(extractBrowserScript(markup())).runInNewContext(context);
  if (activeTab !== "devices")
    new Script("switchTab('" + activeTab + "')").runInNewContext(context);
  await new Promise((resolve) => setImmediate(resolve));
  return elements;
}

async function renderWithUnavailableApi(tab: "devices" | "audit") {
  return runDashboardFixture(async () => ({ ok: false, status: 503 }), tab);
}

async function renderWithDeviceList(devices: unknown[]): Promise<string> {
  const elements = await runDashboardFixture(async () => ({
    ok: true,
    json: async () => ({ devices }),
  }));
  return elements.get("appRoot")?.innerHTML ?? "";
}

function enrolledDevice(connected: boolean) {
  return {
    id: "agent-1",
    alias: "Workstation",
    status: connected ? "online" : "offline",
    isLiveConnected: connected,
    profile: "read-only",
    host_metadata: { os: "Windows", hostname: "Workstation", platform: "win32" },
  };
}

describe("SSH MCP Pro brand and first-use journey", () => {
  test("renders the authorized AI client register without exposing callback query strings", async () => {
    const elements = await runDashboardFixture(
      async () => ({
        ok: true,
        json: async () => ({
          clients: [
            {
              clientId: "client_test",
              clientName: "<script>alert(1)</script>",
              redirectHosts: ["chatgpt.com"],
              lastTokenAt: "2026-11-17T16:00:00Z",
              registeredAt: "2026-11-16T16:00:00Z",
              activeGrants: 2,
              scopes: ["hosts:read", "files:write"],
            },
          ],
        }),
      }),
      "ai-clients",
    );
    const page = elements.get("tabContent")?.innerHTML ?? "";
    expect(page).toContain("Authorized AI clients");
    expect(page).toContain("chatgpt.com");
    expect(page).toContain("Manage access");
    expect(page).toContain("Revoke");
    expect(page).toContain("Elevated scopes");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain("Previously issued access tokens may remain valid until expiry");
  });

  test("new icon contents automatically invalidate old browser caches", async () => {
    const original = readFileSync(new URL("../../assets/ssh-mcp-pro-icon.png", import.meta.url));
    const fingerprint = createHash("sha256").update(original).digest("hex").slice(0, 12);
    const html = markup();
    for (const route of [
      "/favicon.ico",
      "/brand/favicon-32.png",
      "/brand/apple-touch-icon.png",
      "/brand/ssh-mcp-pro-icon.png",
      "/brand/icon-192.png",
      "/site.webmanifest",
    ]) {
      expect(html).toContain(route + "?v=" + fingerprint);
    }
    expect(html).not.toContain('src="/brand/ssh-mcp-pro-icon.png"');
    const dir = mkdtempSync(path.join(os.tmpdir(), "brand-fingerprint-"));
    const plane = new RemoteControlPlane(testConfig(dir));
    await plane.initialize();
    try {
      const response = captureResponse();
      expect(
        await plane.handleHttp(
          request("GET", "/site.webmanifest?v=" + fingerprint),
          response as unknown as ServerResponse,
          "/site.webmanifest",
        ),
      ).toBe(true);
      const manifest = JSON.parse(response.body);
      expect(manifest.icons[0].src).toContain("?v=" + fingerprint);
      expect(manifest.icons[1].src).toContain("?v=" + fingerprint);
    } finally {
      plane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("offline devices show one contextual connection action instead of duplicate banners", async () => {
    const body = await renderWithDeviceList([enrolledDevice(false)]);
    expect(body).toContain("Your devices are offline");
    expect(body.match(/>Check connection <span/g)).toHaveLength(1);
    expect(body).toContain('onclick="retryDevices()"');
    expect(body).not.toContain('class="assistant-next-step"');
    expect(body).not.toContain(">Connect an AI app <span");
  });

  test("online devices show one AI setup action and not an extra next-step card", async () => {
    const body = await renderWithDeviceList([enrolledDevice(true)]);
    expect(body).toContain("You're ready to work");
    expect(body.match(/>Connect an AI app <span/g)).toHaveLength(1);
    expect(body).toContain("onclick=\"switchTab('clients')\"");
    expect(body).not.toContain('class="assistant-next-step"');
    expect(body).not.toContain(">Check connection <span");
  });

  test("the empty state owns its setup button without a second summary button", async () => {
    const body = await renderWithDeviceList([]);
    expect(body).toContain("Let's connect your first computer.");
    expect(body.match(/>Connect a device <span/g)).toHaveLength(1);
    expect(body).not.toContain('class="assistant-next-step"');
  });

  test("connection errors present one retry in the error card", async () => {
    const elements = await renderWithUnavailableApi("devices");
    const body = elements.get("appRoot")?.innerHTML ?? "";
    expect(body).toContain("Device status unavailable");
    expect(body.match(/>Try again</g)).toHaveLength(1);
    expect(body).not.toContain(">Connect a device <span");
  });

  test("ships recognizable, correctly sized icons across browser, Apple and Android surfaces", () => {
    for (const [asset, expectedSize] of [
      ["favicon-16.png", 16],
      ["favicon-32.png", 32],
      ["apple-touch-icon.png", 180],
      ["icon-192.png", 192],
      ["icon-512.png", 512],
    ] as const) {
      const png = readFileSync(new URL("../../assets/brand/" + asset, import.meta.url));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(expectedSize);
      expect(png.readUInt32BE(20)).toBe(expectedSize);
    }
    const ico = readFileSync(new URL("../../assets/brand/favicon.ico", import.meta.url));
    expect(ico.subarray(0, 4).toString("hex")).toBe("00000100");
  });

  test("uses standard favicon and app icon links with a real manifest", () => {
    const html = markup();
    for (const path of [
      "/favicon.ico",
      "/brand/favicon-32.png",
      "/brand/apple-touch-icon.png",
      "/site.webmanifest",
      "/brand/icon-192.png",
    ]) {
      expect(html).toContain(path);
    }
    expect(html).toContain('name="theme-color" content="#10111F"');
  });

  test("shows the outcome and primary sign-in before the supporting product preview", () => {
    const html = renderDashboardHtml(
      Buffer.from("null").toString("base64"),
      JSON.stringify("https://example.test/mcp"),
      JSON.stringify("https://example.test"),
    );
    expect(html).toContain('class="product-stage"');
    expect(html).toContain('class="assistant-chip"');
    expect(html).toContain('class="terminal-preview"');
    const renderedLanding = html.slice(html.indexOf("function renderLanding()"));
    expect(renderedLanding.indexOf("Continue with Google")).toBeLessThan(
      renderedLanding.indexOf('class="product-stage"'),
    );
  });

  test("uses purpose-made vector navigation icons instead of decorative characters", () => {
    const html = markup();
    expect(html).toContain("const navIcons =");
    expect(html).toContain('stroke-width="1.8"');
    expect(html).not.toContain("navItem('devices', '▤'");
    expect(html).not.toContain("navItem('clients', '✦'");
  });

  test("uses a distinctive ink-blue visual identity and separates actions from status", () => {
    const html = markup();
    expect(html).toContain("--accent-blue:#3478f6");
    expect(html).toContain("--surface-primary:#171b2a");
    expect(html).toContain("YOUR DEVICES");
    expect(html).toContain("Quick start");
    expect(html).toContain("npx -y ssh-mcp-pro web");
    expect(html).toContain("navItem('clients'");
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
        'src="/brand/ssh-mcp-pro-icon.png?v=',
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
        "navItem('usage', 'Usage & Users')",
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

  test("serves the standard favicon sizes and app manifest", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brand-routes-"));
    const plane = new RemoteControlPlane(testConfig(dir));
    await plane.initialize();
    try {
      for (const [route, type] of [
        ["/favicon.ico", "image/x-icon"],
        ["/brand/favicon-16.png", "image/png"],
        ["/brand/favicon-32.png", "image/png"],
        ["/brand/icon-192.png", "image/png"],
        ["/brand/icon-512.png", "image/png"],
        ["/brand/apple-touch-icon.png", "image/png"],
        ["/site.webmanifest", "application/manifest+json"],
      ]) {
        const response = captureResponse();
        expect(
          await plane.handleHttp(
            request("GET", route),
            response as unknown as ServerResponse,
            route,
          ),
        ).toBe(true);
        expect(response.statusCode, route).toBe(200);
        expect(response.getHeader("content-type"), route).toContain(type);
        expect(response.getHeader("x-content-type-options"), route).toBe("nosniff");
        if (route === "/site.webmanifest") {
          const manifest = JSON.parse(response.body);
          expect(manifest.name).toBe("SSH MCP Pro");
          expect(manifest.icons[1].sizes).toBe("512x512");
        }
      }
    } finally {
      plane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serves the primary brand icon with secure caching", async () => {
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
