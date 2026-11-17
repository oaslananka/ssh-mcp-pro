import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

/** Return the original owner-supplied PNG unchanged. */
export function serveDashboardBrandIcon(res: ServerResponse): void {
  const image = readFileSync(
    fileURLToPath(new URL("../../assets/ssh-mcp-pro-icon.png", import.meta.url)),
  );
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": String(image.byteLength),
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(image);
}
