import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

type Asset = { path: string; mime: string };
const assets = new Map<string, Asset>([
  ["/favicon.ico", { path: "brand/favicon.ico", mime: "image/x-icon" }],
  ["/brand/ssh-mcp-pro-icon.png", { path: "ssh-mcp-pro-icon.png", mime: "image/png" }],
  ["/brand/favicon-16.png", { path: "brand/favicon-16.png", mime: "image/png" }],
  ["/brand/favicon-32.png", { path: "brand/favicon-32.png", mime: "image/png" }],
  ["/brand/apple-touch-icon.png", { path: "brand/apple-touch-icon.png", mime: "image/png" }],
  ["/brand/icon-192.png", { path: "brand/icon-192.png", mime: "image/png" }],
  ["/brand/icon-512.png", { path: "brand/icon-512.png", mime: "image/png" }],
]);

export const DASHBOARD_BRAND_FINGERPRINT = createHash("sha256")
  .update(
    readFileSync(fileURLToPath(new URL("../../assets/ssh-mcp-pro-icon.png", import.meta.url))),
  )
  .digest("hex")
  .slice(0, 12);

const manifest = JSON.stringify({
  name: "SSH MCP Pro",
  short_name: "SSH MCP Pro",
  description: "Secure access to your computers from AI assistants.",
  start_url: "/dashboard",
  scope: "/",
  display: "standalone",
  background_color: "#10111F",
  theme_color: "#10111F",
  icons: [
    {
      src: "/brand/icon-192.png?v=" + DASHBOARD_BRAND_FINGERPRINT,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/brand/icon-512.png?v=" + DASHBOARD_BRAND_FINGERPRINT,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ],
});

export function serveDashboardBrandAsset(res: ServerResponse, pathname: string): boolean {
  if (pathname === "/site.webmanifest") {
    res.writeHead(200, {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(manifest)),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    });
    res.end(manifest);
    return true;
  }

  const asset = assets.get(pathname);
  if (!asset) return false;
  const bytes = readFileSync(fileURLToPath(new URL("../../assets/" + asset.path, import.meta.url)));
  res.writeHead(200, {
    "Content-Type": asset.mime,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(bytes);
  return true;
}
