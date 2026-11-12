import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const MAX_BODY_BYTES = 4_096;
const DEFAULT_TIMEOUT_MS = 600_000;

export interface LocalBrowserEnrollment {
  verificationUrl: string;
  callbackUrl: string;
  port: number;
  finished: Promise<void>;
  close(): void;
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validServerOrigin(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new Error("Browser enrollment requires an HTTPS server or local loopback URL");
  }
  return url.origin;
}

function send(
  res: ServerResponse,
  code: number,
  message: string,
  origin?: string,
  preflight = false,
): void {
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          ...(preflight
            ? {
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "content-type",
                "Access-Control-Max-Age": "0",
              }
            : {}),
        }
      : {}),
  });
  res.end(message);
}

async function readLimitedJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds limit");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * A same-device HTTPS dashboard may hand its one-time token directly to a
 * loopback listener. Only the bound browser origin, random challenge and
 * local socket are accepted; the one-time token never appears in the URL.
 */
export async function startLocalBrowserEnrollment(
  serverUrl: string,
  alias: string,
  onToken: (token: string) => Promise<void>,
  options: { timeoutMs?: number } = {},
): Promise<LocalBrowserEnrollment> {
  const origin = validServerOrigin(serverUrl);
  const state = randomBytes(32).toString("base64url");
  let complete!: () => void;
  let fail!: (error: Error) => void;
  let settled = false;
  const finished = new Promise<void>((resolve, reject) => {
    complete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });
  // Closing early is allowed without an unhandled rejection, while callers
  // awaiting finished still receive the same timeout/cancellation failure.
  void finished.catch(() => {});

  let enrolled = false;
  const listener = createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, "Local approval failed");
    });
  });
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress ?? "";
    const localOnly = remote === "127.0.0.1";
    if (!localOnly || req.headers.origin !== origin) {
      send(res, 403, "Browser origin is not allowed");
      return;
    }
    const address = listener.address() as AddressInfo;
    if (
      req.headers.host !== `127.0.0.1:${address.port}` ||
      (req.url !== "/enroll" && req.url !== "/ready")
    ) {
      send(res, 403, "Unexpected callback destination", origin);
      return;
    }
    if (req.method === "GET" && req.url === "/ready") {
      send(res, 204, "", origin);
      return;
    }
    if (req.method === "OPTIONS") {
      send(res, 204, "", origin, true);
      return;
    }
    if (req.method !== "POST" || enrolled) {
      send(res, 405, "Enrollment is not available", origin);
      return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      send(res, 415, "JSON required", origin);
      return;
    }
    let body: unknown;
    try {
      body = await readLimitedJson(req);
    } catch {
      send(res, 400, "Invalid enrollment request", origin);
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      send(res, 400, "Invalid enrollment request", origin);
      return;
    }
    const data = body as Record<string, unknown>;
    if (typeof data.state !== "string" || !safeEqual(state, data.state)) {
      send(res, 403, "Enrollment link does not match", origin);
      return;
    }
    if (typeof data.token !== "string" || !/^[A-Za-z0-9_-]{30,256}$/u.test(data.token)) {
      send(res, 400, "Enrollment token is missing or malformed", origin);
      return;
    }
    enrolled = true;
    try {
      await onToken(data.token);
      send(res, 200, "Enrollment accepted", origin);
      complete();
      listener.close();
    } catch {
      enrolled = false;
      send(res, 502, "Device enrollment failed; check the agent terminal", origin);
    }
  }
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      listener.off("error", reject);
      resolve();
    });
  });
  const address = listener.address() as AddressInfo;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    listener.close();
    throw new Error("Invalid local browser enrollment timeout");
  }
  const timer = setTimeout(() => {
    fail(new Error("Browser enrollment expired; restart the installer"));
    listener.close();
  }, timeoutMs);
  timer.unref();

  void finished
    .finally(() => {
      clearTimeout(timer);
    })
    .catch(() => {});

  const dashboardUrl = new URL("/dashboard", origin);
  dashboardUrl.searchParams.set("local_enroll_port", String(address.port));
  dashboardUrl.searchParams.set("local_enroll_state", state);
  dashboardUrl.searchParams.set("local_enroll_alias", alias);
  return {
    verificationUrl: dashboardUrl.toString(),
    callbackUrl: `http://127.0.0.1:${address.port}/enroll`,
    port: address.port,
    finished,
    close() {
      fail(new Error("Browser enrollment cancelled"));
      clearTimeout(timer);
      listener.close();
    },
  };
}
