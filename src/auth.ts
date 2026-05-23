import { createHash, timingSafeEqual } from "node:crypto";

function sha256(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

export function constantTimeTokenEquals(provided: string, expected: string): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  if (expected.length === 0) {
    return false;
  }

  const providedDigest = sha256(provided);
  const expectedDigest = sha256(expected);
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function extractBearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || parts[1]?.length === 0) {
    return undefined;
  }

  return parts[1];
}

export function isBearerAuthorizationValid(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const providedToken = extractBearerToken(authorization);
  if (providedToken === undefined) {
    return false;
  }

  return constantTimeTokenEquals(providedToken, expectedToken);
}
