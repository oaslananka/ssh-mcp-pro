import { createRemoteJWKSet, jwtVerify } from "jose";
import { asString, safeError } from "./http-util.js";

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
import type { GitHubUser, GoogleUser, RemoteConfig } from "./types.js";

export async function fetchGitHubUserDirect(
  config: RemoteConfig,
  code: string,
): Promise<GitHubUser> {
  const callbackUrl = `${config.publicBaseUrl}/auth/callback/github`;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: callbackUrl,
    }),
  });
  const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
  const accessToken = asString(tokenPayload.access_token);
  if (!accessToken) {
    throw safeError("INVALID_TOKEN", "GitHub OAuth token exchange failed", 502);
  }
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  const userPayload = (await userResponse.json()) as Record<string, unknown>;
  const githubId = userPayload.id;
  const githubLogin = userPayload.login;
  if (typeof githubId !== "number" || typeof githubLogin !== "string" || !githubLogin) {
    throw safeError("INVALID_TOKEN", "GitHub user response missing valid identity", 502);
  }
  return { id: String(githubId), login: githubLogin };
}

export async function fetchGoogleUserDirect(
  config: RemoteConfig,
  code: string,
  nonce: string,
): Promise<GoogleUser> {
  const callbackUrl = `${config.publicBaseUrl}/auth/callback/google`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId ?? "",
      client_secret: config.googleClientSecret ?? "",
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }).toString(),
  });
  const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
  const idToken = asString(tokenPayload.id_token);
  const clientId = config.googleClientId;
  if (!tokenResponse.ok || !idToken || !clientId || !nonce) {
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
