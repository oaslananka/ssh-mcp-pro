import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

/** Serve only the two explicit agent installer routes; never accept user-supplied paths. */
export function serveAgentScript(
  res: ServerResponse,
  relativePath: string,
  contentType: string,
): void {
  const fullPath = path.resolve(relativePath);
  if (!existsSync(fullPath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Script file not found on server");
    return;
  }
  const content = readFileSync(fullPath, "utf8");
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(content);
}
