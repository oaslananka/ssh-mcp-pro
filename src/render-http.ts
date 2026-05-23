import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bearerToken = process.env.SSH_MCP_HTTP_BEARER_TOKEN?.trim();

if (bearerToken && !process.env.SSH_MCP_HTTP_BEARER_TOKEN_FILE) {
  const tokenDir = mkdtempSync(join(tmpdir(), "ssh-mcp-pro-"));
  chmodSync(tokenDir, 0o700);
  const tokenPath = join(tokenDir, "bearer-token");
  writeFileSync(tokenPath, bearerToken, { encoding: "utf8", mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  process.env.SSH_MCP_HTTP_BEARER_TOKEN_FILE = tokenPath;
}

await import("./server-http.js");
