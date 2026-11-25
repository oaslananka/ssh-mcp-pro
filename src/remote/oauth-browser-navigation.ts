import type { ServerResponse } from "node:http";
import { escape as escapeHtml } from "html-escaper";
import type { URL } from "node:url";

/**
 * Avoid chaining browser form submissions through third-party OAuth redirects
 * and then back to the MCP client. Chromium applies form-action to redirects;
 * the final client callback is deliberately not a permitted form destination.
 * A new document starts an ordinary navigation instead.
 */
export function continueBrowserNavigation(
  res: ServerResponse,
  destination: URL,
  target: "GitHub" | "Google" | "MCP client",
): void {
  const href = escapeHtml(destination.toString());
  const label = target === "MCP client" ? "Return to MCP client" : "Continue with " + target;
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  res.end(
    [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>",
      label,
      " — ssh-mcp-pro</title>",
      '<meta http-equiv="refresh" content="0;url=',
      href,
      '">',
      "</head><body>",
      '<p>Continue securely to the selected destination.</p><a href="',
      href,
      '\">',
      label,
      "</a>",
      "</body></html>",
    ].join(""),
  );
}
