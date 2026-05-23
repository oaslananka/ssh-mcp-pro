import type { ServerResponse } from "node:http";

export function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(body, null, 2));
}

export function formDecode(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const decoded: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key in decoded) {
      throw new Error(`Duplicate form parameter: ${key}`);
    }
    decoded[key] = value;
  }
  return decoded;
}

export function userSafeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    if (message && code) {
      return `${code}: ${message}`;
    }
    if (message) {
      return message;
    }
  }
  return String(error);
}
