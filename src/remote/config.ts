import path from "node:path";
import { parseList } from "./util.js";
import type { RemoteConfig } from "./types.js";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

export function loadRemoteConfig(): RemoteConfig {
  const publicBaseUrl = stripTrailingSlash(
    process.env.PUBLIC_BASE_URL ??
      process.env.SSHAUTOMATOR_PUBLIC_BASE_URL ??
      "http://localhost:3000",
  );
  return {
    enabled: parseBoolean(
      process.env.SSH_MCP_REMOTE_AGENT_CONTROL_PLANE ??
        process.env.SSHAUTOMATOR_REMOTE_AGENT_CONTROL_PLANE,
      false,
    ),
    publicBaseUrl,
    mcpResourceUrl:
      process.env.MCP_RESOURCE_URL ??
      process.env.SSHAUTOMATOR_MCP_RESOURCE_URL ??
      `${publicBaseUrl}/mcp`,
    databaseUrl:
      process.env.DATABASE_URL ??
      process.env.SSHAUTOMATOR_DATABASE_URL ??
      "file:./data/sshautomator.db",
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    githubCallbackUrl:
      process.env.GITHUB_CALLBACK_URL ??
      process.env.SSHAUTOMATOR_GITHUB_CALLBACK_URL ??
      `${publicBaseUrl}/oauth/callback/github`,
    allowAllUsers: parseBoolean(process.env.AUTH_ALLOW_ALL_USERS, false),
    allowedGitHubLogins: parseList(process.env.AUTH_ALLOWED_GITHUB_LOGINS),
    allowedGitHubIds: parseList(process.env.AUTH_ALLOWED_GITHUB_IDS),
    accessTokenTtlSeconds: parseInteger(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
    authCodeTtlSeconds: parseInteger(process.env.AUTH_CODE_TTL_SECONDS, 300),
    enrollmentTokenTtlSeconds: parseInteger(process.env.ENROLLMENT_TOKEN_TTL_SECONDS, 600),
    controlPlaneSigningKeyPath:
      process.env.CONTROL_PLANE_SIGNING_KEY_PATH ?? path.join("data", "control-plane-ed25519.json"),
    jwtSigningKeyPath: process.env.JWT_SIGNING_KEY_PATH ?? path.join("data", "jwt-ed25519.json"),
    agentWsPath: process.env.AGENT_WS_PATH ?? "/api/agents/connect",
    maxActionTimeoutSeconds: parseInteger(process.env.MAX_ACTION_TIMEOUT_SECONDS, 120),
    maxOutputBytes: parseInteger(process.env.MAX_OUTPUT_BYTES, 200_000),
    maxOAuthClients: parseInteger(process.env.OAUTH_DCR_MAX_CLIENTS, 100),
  };
}
