import { createPublicKey } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { sha256Base64Url } from "./crypto.js";
import { parseScopes } from "./scopes.js";
import type { RemoteAgentRecord, RemoteErrorCode, RemoteScope } from "./types.js";
import { REMOTE_SCOPES } from "./types.js";
import { formDecode } from "./util.js";

export const AGENT_NONCE_TTL_MS = 300_000;
export const MAX_AGENT_CONNECTION_NONCES = 4096;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function negotiateMcpProtocolVersion(params: unknown): string {
  const requestedVersion = isRecord(params) ? asString(params.protocolVersion) : undefined;
  return requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : LATEST_PROTOCOL_VERSION;
}

export function quotePosixArg(value: string): string {
  const escaped = value.replaceAll("'", "'\"'\"'");
  return `'${escaped}'`;
}

export function quotePowerShellArg(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function pruneNonceWindow(nonces: Map<string, number>, now = Date.now()): void {
  for (const [nonce, expiresAt] of nonces.entries()) {
    if (expiresAt <= now) {
      nonces.delete(nonce);
    }
  }
}

export function hasSeenNonce(
  nonces: Map<string, number>,
  nonce: string,
  now = Date.now(),
): boolean {
  pruneNonceWindow(nonces, now);
  return nonces.has(nonce);
}

export function rememberNonce(nonces: Map<string, number>, nonce: string, now = Date.now()): void {
  pruneNonceWindow(nonces, now);
  nonces.set(nonce, now + AGENT_NONCE_TTL_MS);
  while (nonces.size > MAX_AGENT_CONNECTION_NONCES) {
    const oldest = nonces.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    nonces.delete(oldest);
  }
}

export function addNoStore(headers: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    ...headers,
  };
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

export function safeError(
  code: RemoteErrorCode,
  message: string,
  status = 400,
): { code: RemoteErrorCode; message: string; status: number } {
  return { code, message, status };
}

export function isValidEd25519PublicKey(publicKeyPem: string): boolean {
  try {
    return createPublicKey(publicKeyPem).asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

export async function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw safeError("FORBIDDEN", "Request body is too large", 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw safeError("INTERNAL_ERROR", "Expected JSON object");
  }
  return parsed;
}

export async function readJsonOrForm(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(req);
  const contentType = req.headers["content-type"] ?? "";
  if (String(contentType).includes("application/json")) {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!isRecord(parsed)) {
      throw safeError("INTERNAL_ERROR", "Expected JSON object");
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        typeof value === "string" ? value : String(value ?? ""),
      ]),
    );
  }
  try {
    return formDecode(raw);
  } catch {
    throw safeError("INVALID_CLIENT", "Duplicate form parameter");
  }
}

export function isSafeRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") {
      return true;
    }
    return (
      parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

export function scopeList(scope: string): RemoteScope[] {
  const valid = new Set<string>(REMOTE_SCOPES);
  const rawScopes = scope.split(/\s+/u).filter(Boolean);
  if (rawScopes.some((entry) => !valid.has(entry))) {
    throw safeError("INVALID_SCOPE", "Requested scope is not supported");
  }
  const scopes = parseScopes(scope);
  return scopes.length > 0 ? scopes : ["hosts:read", "agents:read", "status:read", "logs:read"];
}

export function sanitizeAgent(agent: RemoteAgentRecord): Record<string, unknown> {
  return {
    id: agent.id,
    alias: agent.alias,
    status: agent.status,
    profile: agent.profile,
    policy_version: agent.policyVersion,
    host_metadata: agent.hostMetadata,
    last_seen_at: agent.lastSeenAt,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
  };
}
