import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

/** Serve only explicit agent installer routes; never accept user-supplied paths. */
export function serveAgentScript(
  res: ServerResponse,
  relativePath: string,
  contentType: string,
  options?: { publicBaseUrl?: string },
): void {
  const fullPath = path.resolve(relativePath);
  if (!existsSync(fullPath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Script file not found on server");
    return;
  }
  let content = readFileSync(fullPath, "utf8");
  if (options?.publicBaseUrl) {
    const url = options.publicBaseUrl.replace(/\/+$/u, "");
    if (relativePath.endsWith(".ps1")) {
      content = content.replace(
        '[string]$Server = "http://127.0.0.1:3000"',
        `[string]$Server = "${url}"`,
      );
    } else if (relativePath.endsWith(".sh")) {
      content = content.replace(
        'SERVER=""\nTOKEN=""\nBROWSER_ENROLL=false',
        `SERVER="${url}"\nTOKEN=""\nBROWSER_ENROLL=true`,
      );
    }
  }
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": options?.publicBaseUrl ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(content);
}
