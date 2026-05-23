import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { extractBearerToken } from "./auth.js";

export interface OAuthVerificationConfig {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  requiredScopes: string[];
  allowedAlgorithms?: string[];
  jwksTimeoutMs?: number;
  jwksCooldownMs?: number;
  jwksCacheMaxAgeMs?: number;
}

const DEFAULT_ALLOWED_ALGORITHMS = ["RS256"];
const DEFAULT_JWKS_TIMEOUT_MS = 5000;
const DEFAULT_JWKS_COOLDOWN_MS = 30_000;
const DEFAULT_JWKS_CACHE_MAX_AGE_MS = 300_000;
const jwksCache = new Map<string, JWTVerifyGetKey>();

export async function isOAuthAuthorizationValid(
  authorization: string | undefined,
  config: OAuthVerificationConfig,
): Promise<boolean> {
  try {
    await verifyOAuthAuthorization(authorization, config);
    return true;
  } catch {
    return false;
  }
}

export async function verifyOAuthAuthorization(
  authorization: string | undefined,
  config: OAuthVerificationConfig,
): Promise<Record<string, unknown>> {
  if (!config.issuer || !config.audience || !config.jwksUrl) {
    throw new Error("OAuth issuer, audience, and JWKS URL are required");
  }

  const token = extractBearerToken(authorization);
  if (!token) {
    throw new Error("Missing bearer token");
  }

  const algorithms = config.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGORITHMS;
  const { payload, protectedHeader } = await jwtVerify(token, getJwks(config), {
    issuer: config.issuer,
    audience: config.audience,
    algorithms,
    clockTolerance: "5s",
    requiredClaims: ["iss", "aud", "exp", "iat"],
  });

  if (!protectedHeader.kid) {
    throw new Error("JWT kid is required");
  }
  if (!protectedHeader.alg || !algorithms.includes(protectedHeader.alg)) {
    throw new Error("Unsupported JWT algorithm");
  }

  validateClaims(payload, config);
  return payload;
}

function getJwks(config: OAuthVerificationConfig): JWTVerifyGetKey {
  const key = [
    config.jwksUrl,
    config.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
    config.jwksCooldownMs ?? DEFAULT_JWKS_COOLDOWN_MS,
    config.jwksCacheMaxAgeMs ?? DEFAULT_JWKS_CACHE_MAX_AGE_MS,
  ].join("|");

  const cached = jwksCache.get(key);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(config.jwksUrl ?? ""), {
    timeoutDuration: config.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
    cooldownDuration: config.jwksCooldownMs ?? DEFAULT_JWKS_COOLDOWN_MS,
    cacheMaxAge: config.jwksCacheMaxAgeMs ?? DEFAULT_JWKS_CACHE_MAX_AGE_MS,
  });
  jwksCache.set(key, jwks);
  return jwks;
}

function validateClaims(payload: JWTPayload, config: OAuthVerificationConfig): void {
  if (payload.iss !== config.issuer) {
    throw new Error("JWT issuer mismatch");
  }
  if (!audienceMatches(payload.aud, config.audience ?? "")) {
    throw new Error("JWT audience mismatch");
  }

  const scopes = extractScopes(payload);
  for (const requiredScope of config.requiredScopes) {
    if (!scopes.has(requiredScope)) {
      throw new Error("JWT required scope is missing");
    }
  }
}

function audienceMatches(audience: unknown, expected: string): boolean {
  return audience === expected || (Array.isArray(audience) && audience.includes(expected));
}

function extractScopes(payload: JWTPayload): Set<string> {
  const scopes = new Set<string>();
  if (typeof payload.scope === "string") {
    for (const scope of payload.scope.split(/\s+/).filter(Boolean)) {
      scopes.add(scope);
    }
  }
  if (typeof payload.scp === "string") {
    for (const scope of payload.scp.split(/\s+/).filter(Boolean)) {
      scopes.add(scope);
    }
  }
  if (Array.isArray(payload.scp)) {
    for (const scope of payload.scp) {
      if (typeof scope === "string") {
        scopes.add(scope);
      }
    }
  }
  return scopes;
}

export function normalizeOAuthError(error: unknown): Error {
  if (error instanceof joseErrors.JOSEError) {
    return new Error(error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}
