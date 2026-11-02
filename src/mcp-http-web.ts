import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Adapt the already size-limited parsed JSON body to the SDK's Web Request.
 * This keeps the existing authentication, origin and body-size checks before MCP dispatch.
 */
export function toMcpWebRequest(req: IncomingMessage, parsedBody?: unknown): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    }
  }

  const url = new URL(req.url ?? "/mcp", "http://localhost");
  return new Request(url, {
    method: req.method ?? "POST",
    headers,
    ...(req.method === "POST" && parsedBody !== undefined
      ? { body: JSON.stringify(parsedBody) }
      : {}),
  });
}

export async function sendMcpWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}
