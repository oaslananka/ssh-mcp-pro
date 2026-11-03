import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as nodeSign,
  timingSafeEqual,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { extractBearerToken } from "../auth.js";
import type { RemoteConfig, RemotePrincipal, RemoteScope } from "./types.js";
import { capabilitiesFromScopes } from "./scopes.js";

export interface PemKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface JwtKeyPair {
  publicKey: Awaited<ReturnType<typeof importSPKI>>;
  privateKey: Awaited<ReturnType<typeof importPKCS8>>;
  publicKeyPem: string;
  privateKeyPem: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function hashSecret(value: string): string {
  return sha256Base64Url(value);
}

export function safeSecretEqual(provided: string, expectedHash: string): boolean {
  const providedHash = hashSecret(provided);
  const providedBytes = Buffer.from(providedHash);
  const expectedBytes = Buffer.from(expectedHash);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

export function generateEd25519PemKeyPair(): PemKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function ensurePemKeyPair(filePath: string): PemKeyPair {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as PemKeyPair;
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
    const keyPair = generateEd25519PemKeyPair();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(keyPair, null, 2), { mode: 0o600 });
    return keyPair;
  }
}

export async function loadJwtKeyPair(filePath: string): Promise<JwtKeyPair> {
  const pem = ensurePemKeyPair(filePath);
  return {
    ...pem,
    publicKey: await importSPKI(pem.publicKeyPem, "EdDSA"),
    privateKey: await importPKCS8(pem.privateKeyPem, "EdDSA"),
  };
}

export async function publicJwkFromPem(publicKeyPem: string): Promise<Record<string, unknown>> {
  const publicKey = await importSPKI(publicKeyPem, "EdDSA");
  const jwk = await exportJWK(publicKey);
  return { ...jwk, use: "sig", alg: "EdDSA", kid: keyId(publicKeyPem) };
}

export function keyId(publicKeyPem: string): string {
  return sha256Base64Url(publicKeyPem).slice(0, 24);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
  const properties = entries.map(
    ([key, entryValue]) => JSON.stringify(key) + ":" + canonicalJson(entryValue),
  );
  return `{${properties.join(",")}}`;
}

export function signEnvelope<T extends Record<string, unknown>>(
  envelope: T,
  privateKey: KeyObject | string,
): string {
  const unsigned = { ...envelope };
  delete unsigned.signature;
  return nodeSign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64url");
}

export function verifyEnvelope(
  envelope: Record<string, unknown>,
  publicKey: KeyObject | string,
): boolean {
  const signature = typeof envelope.signature === "string" ? envelope.signature : "";
  const unsigned = { ...envelope };
  delete unsigned.signature;
  if (!signature) {
    return false;
  }
  return nodeVerify(
    null,
    Buffer.from(canonicalJson(unsigned)),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
}

export interface TokenUserIdentity {
  id: string;
  githubId?: string | undefined;
  githubLogin?: string | undefined;
  googleId?: string | undefined;
  email?: string | undefined;
  displayName?: string | undefined;
  provider?: "github" | "google" | undefined;
}

export async function issueAccessToken(
  config: RemoteConfig,
  keyPair: JwtKeyPair,
  user: TokenUserIdentity,
  scopes: RemoteScope[],
): Promise<{ token: string; tokenId: string; expiresAt: string }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + config.accessTokenTtlSeconds;
  const tokenId = id("tok");
  const githubLogin = user.githubLogin ?? user.displayName ?? user.email ?? user.id;
  const githubId = user.githubId ?? user.googleId ?? user.id;
  const claims: Record<string, unknown> = {
    scope: scopes.join(" "),
    github_login: githubLogin,
    github_id: githubId,
  };
  if (user.googleId) {
    claims.google_id = user.googleId;
  }
  if (user.email) {
    claims.email = user.email;
  }
  if (user.displayName) {
    claims.display_name = user.displayName;
  }
  if (user.provider) {
    claims.provider = user.provider;
  }
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: keyId(keyPair.publicKeyPem) })
    .setIssuer(config.publicBaseUrl)
    .setSubject(user.id)
    .setAudience(config.mcpResourceUrl)
    .setJti(tokenId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(keyPair.privateKey);

  return {
    token,
    tokenId,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

export async function verifyRemoteAccessToken(
  authorization: string | undefined,
  config: RemoteConfig,
  keyPair: JwtKeyPair,
): Promise<RemotePrincipal> {
  const token = extractBearerToken(authorization);
  if (!token) {
    throw new Error("Missing bearer token");
  }
  const { payload } = await jwtVerify(token, keyPair.publicKey, {
    issuer: config.publicBaseUrl,
    audience: config.mcpResourceUrl,
    algorithms: ["EdDSA"],
    requiredClaims: ["iss", "aud", "exp", "iat", "sub", "jti"],
  });
  return principalFromPayload(payload);
}

function principalFromPayload(payload: JWTPayload): RemotePrincipal {
  const scopes =
    typeof payload.scope === "string" ? payload.scope.split(/\s+/u).filter(Boolean) : [];
  if (
    ("github_id" in payload && typeof payload.github_id !== "string") ||
    ("github_login" in payload && typeof payload.github_login !== "string")
  ) {
    throw new TypeError("Invalid GitHub identity claims");
  }
  const githubId = typeof payload.github_id === "string" ? payload.github_id : "";
  const githubLogin = typeof payload.github_login === "string" ? payload.github_login : "";
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const displayName = typeof payload.display_name === "string" ? payload.display_name : undefined;
  const provider =
    payload.provider === "google" || payload.provider === "github" ? payload.provider : undefined;
  return {
    userId: String(payload.sub),
    githubId,
    githubLogin,
    email,
    displayName,
    provider,
    scopes: scopes as RemoteScope[],
    capabilities: capabilitiesFromScopes(scopes as RemoteScope[]),
    tokenId: String(payload.jti),
  };
}
