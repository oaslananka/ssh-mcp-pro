import type { ServerResponse } from "node:http";

/** Integration harnesses must never return raw exception messages or stack traces. */
export function writeTestHttpError(res: ServerResponse, error: unknown): void {
  const rawStatus =
    error && typeof error === "object" && "status" in error ? error.status : undefined;
  const status =
    typeof rawStatus === "number" &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 400 &&
    rawStatus <= 599
      ? rawStatus
      : 500;
  const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const code =
    typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode) ? rawCode : undefined;

  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ error: status >= 500 ? "Internal server error" : "Request rejected", code }),
  );
}
