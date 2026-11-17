import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

const pages = {
  "/privacy": { file: "privacy-policy.md", title: "Privacy policy" },
  "/terms": { file: "terms-of-service.md", title: "Terms of service" },
} as const;

/** The hosted legal pages derive from the shipped source docs, not a second copy. */
export function serveLegalPage(res: ServerResponse, pathname: "/privacy" | "/terms"): void {
  const page = pages[pathname];
  const path = fileURLToPath(new URL("../../docs/security/" + page.file, import.meta.url));
  const content = readFileSync(path, "utf8");
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/gu,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
    );
  const body = content
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => {
      if (line.startsWith("# ")) return "<h1>" + escapeHtml(line.slice(2)) + "</h1>";
      if (line.startsWith("## ")) return "<h2>" + escapeHtml(line.slice(3)) + "</h2>";
      if (line.startsWith("- ")) return '<p class="item">' + escapeHtml(line.slice(2)) + "</p>";
      return "<p>" + escapeHtml(line.replaceAll("**", "").replaceAll("*", "")) + "</p>";
    })
    .join("\n");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
      page.title +
      ' — ssh-mcp-pro</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e8edf8;font:16px/1.8 system-ui,sans-serif}.shell{width:min(100% - 36px,780px);margin:48px auto 80px}a{color:#8edcd2}h1{font-size:clamp(32px,5vw,48px);letter-spacing:-.04em;line-height:1.12}h2{font-size:21px;margin-top:38px;line-height:1.3}p{color:#b9c6d8}.item{padding-left:18px;border-left:2px solid #4fc1ab}.brand{font-size:13px;color:#80c7bd;text-transform:uppercase;letter-spacing:.2em}footer{margin-top:52px;padding-top:20px;border-top:1px solid #243149;color:#98a8bd}</style></head><body><main class="shell"><div class="brand">ssh-mcp-pro · Trust Center</div>' +
      body +
      '<footer><a href="/">Back to dashboard</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer></main></body></html>',
  );
}
