import { asString, safeError } from "./http-util.js";
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
  const accessToken = asString(tokenPayload.access_token);
  if (!accessToken) {
    throw safeError("INVALID_TOKEN", "Google OAuth token exchange failed", 502);
  }
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userPayload = (await userResponse.json()) as Record<string, unknown>;
  const sub = asString(userPayload.sub);
  const email = asString(userPayload.email);
  const name = asString(userPayload.name) ?? email ?? "Google User";
  const picture = asString(userPayload.picture);
  if (!sub || !email) {
    throw safeError("INVALID_TOKEN", "Google user response missing identity", 502);
  }
  return { id: sub, email, name, picture };
}
