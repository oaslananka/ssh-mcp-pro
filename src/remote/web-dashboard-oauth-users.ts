import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { asString, safeError } from "./http-util.js";
import { exchangeGitHubIdentity, requestGoogleOAuthToken } from "./oauth-provider-exchange.js";
import type { GitHubUser, GoogleUser, RemoteConfig } from "./types.js";

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function fetchGitHubUserDirect(
  config: RemoteConfig,
  code: string,
): Promise<GitHubUser> {
  const callbackUrl = `${config.publicBaseUrl}/auth/callback/github`;
  return exchangeGitHubIdentity(config, code, callbackUrl);
}

export async function fetchGoogleUserDirect(
  config: RemoteConfig,
  code: string,
  nonce: string,
): Promise<GoogleUser> {
  const callbackUrl = config.googleCallbackUrl;
  const { tokenPayload, responseOk } = await requestGoogleOAuthToken(config, code, callbackUrl);
  const idToken = asString(tokenPayload.id_token);
  const clientId = config.googleClientId;
  if (!responseOk || !idToken || !clientId || !nonce) {
    throw safeError("INVALID_TOKEN", "Google OIDC token exchange failed", 502);
  }

  let claims: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    const verified = await jwtVerify(idToken, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      algorithms: ["RS256"],
    });
    claims = verified.payload;
  } catch {
    throw safeError("INVALID_TOKEN", "Google OIDC ID token validation failed", 403);
  }

  return googleIdentityFromVerifiedClaims(claims, nonce);
}

function googleIdentityFromVerifiedClaims(claims: JWTPayload, nonce: string): GoogleUser {
  if (
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    !claims.email ||
    claims.email_verified !== true ||
    claims.nonce !== nonce
  ) {
    throw safeError("INVALID_TOKEN", "Google OIDC identity or nonce mismatch", 403);
  }
  const name = typeof claims.name === "string" ? claims.name : claims.email;
  const picture = typeof claims.picture === "string" ? claims.picture : undefined;
  return { id: claims.sub, email: claims.email, name, picture };
}
