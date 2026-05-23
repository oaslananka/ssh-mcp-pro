import { isRemoteSafeToolProfile, type ToolProfile } from "./connector-profile.js";
import type { HostKeyPolicy } from "./types.js";

export interface HttpStartupConfig {
  host: string;
  allowedOrigins: string[];
  bearerTokenFile?: string;
  publicUrl?: string;
}

export interface HttpStartupSecurityContext {
  toolProfile: ToolProfile;
  allowedHosts: string[];
  hostKeyPolicy?: HostKeyPolicy;
  authMode?: "bearer" | "oauth";
  oauthConfigured?: boolean;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}

export function validateHttpStartupConfig(
  httpConfig: HttpStartupConfig,
  bearerToken: string | undefined,
  context: HttpStartupSecurityContext = {
    toolProfile: "full",
    allowedHosts: [],
    hostKeyPolicy: "strict",
    authMode: "bearer",
    oauthConfigured: false,
  },
): void {
  if (httpConfig.bearerTokenFile && bearerToken?.length === 0) {
    throw new Error("Refusing HTTP MCP startup with an empty bearer token file");
  }

  if (isLoopbackHost(httpConfig.host)) {
    return;
  }

  const hasBearerAuth = Boolean(bearerToken);
  const hasOAuthAuth = context.authMode === "oauth" && context.oauthConfigured === true;
  if ((!hasBearerAuth && !hasOAuthAuth) || httpConfig.allowedOrigins.length === 0) {
    throw new Error(
      "Refusing non-loopback HTTP MCP binding without SSH_MCP_HTTP_BEARER_TOKEN_FILE or OAuth config, and SSH_MCP_HTTP_ALLOWED_ORIGINS",
    );
  }

  if (!httpConfig.publicUrl) {
    throw new Error(
      "Refusing non-loopback HTTP MCP binding without SSH_MCP_HTTP_PUBLIC_URL for stable protected resource metadata",
    );
  }
  try {
    const publicUrl = new URL(httpConfig.publicUrl);
    if (publicUrl.protocol !== "https:") {
      throw new Error("public URL must use HTTPS");
    }
    if (isLoopbackHost(publicUrl.hostname)) {
      throw new Error("public URL must not use a loopback host");
    }
  } catch (error) {
    throw new Error(
      `Refusing non-loopback HTTP MCP binding with invalid SSH_MCP_HTTP_PUBLIC_URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRemoteSafeToolProfile(context.toolProfile)) {
    throw new Error(
      "Refusing non-loopback HTTP MCP binding with full tool profile. Set SSH_MCP_TOOL_PROFILE=remote-safe, chatgpt, claude, remote-readonly, or remote-broker.",
    );
  }

  if (context.allowedHosts.length === 0) {
    throw new Error(
      "Refusing non-loopback HTTP MCP binding without SSH_MCP_ALLOWED_HOSTS for remote connector profile",
    );
  }

  if ((context.hostKeyPolicy ?? "strict") !== "strict") {
    throw new Error(
      "Refusing non-loopback HTTP MCP binding without strict SSH host-key verification",
    );
  }
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}

export function corsHeaders(
  origin: string | undefined,
  allowedOrigins: string[],
): Record<string, string> {
  if (!origin || !isOriginAllowed(origin, allowedOrigins)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "mcp-session-id, WWW-Authenticate",
    Vary: "Origin",
  };
}

export function oauthProtectedResourceMetadataUrl(publicMcpUrl: string): string {
  const url = new URL(publicMcpUrl);
  url.username = "";
  url.password = "";
  url.pathname = "/.well-known/oauth-protected-resource";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function oauthWwwAuthenticateHeader(
  resourceMetadataUrl: string,
  scopes: readonly string[],
  includeErrorDetails = false,
): string {
  const parts = [`resource_metadata="${resourceMetadataUrl}"`];
  if (scopes.length > 0) {
    parts.push(`scope="${scopes.join(" ")}"`);
  }
  if (includeErrorDetails) {
    parts.push('error="invalid_token"');
    parts.push('error_description="A valid OAuth access token is required"');
  }
  return `Bearer ${parts.join(", ")}`;
}
