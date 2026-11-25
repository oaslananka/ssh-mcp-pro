import { URL } from "node:url";
import { id, nowIso } from "./crypto.js";
import { isSafeRedirectUri, safeError, scopeList } from "./http-util.js";
import type { RemoteStore } from "./store.js";
import type { AuditEvent, OAuthClient, RemoteConfig } from "./types.js";

function isRestorableClientId(clientId: string): boolean {
  if (!clientId.startsWith("cli_") || clientId.length === 4) return false;
  for (let index = 4; index < clientId.length; index++) {
    const code = clientId.charCodeAt(index);
    if (!(
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 95 ||
      code === 45
    ))
      return false;
  }
  return true;
}

export class OAuthClientValidator {
  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {}

  validateAuthorizeParams(
    clientId: string,
    redirectUri: string,
    responseType: string,
    codeChallenge: string,
    codeChallengeMethod: string,
    resource: string,
    scope: string,
  ): void {
    let client = this.store.getClient(clientId);
    if (!client) {
      client = this.restoreChatGptClient(clientId, redirectUri);
    } else if (!client.redirectUris.includes(redirectUri)) {
      client = this.addChatGptRedirectUri(client, redirectUri) ?? client;
    }
    if (!client) {
      throw safeError("INVALID_CLIENT", "Unknown client_id");
    }
    if (!client.redirectUris.includes(redirectUri) || !isSafeRedirectUri(redirectUri)) {
      throw safeError("INVALID_REDIRECT_URI", "redirect_uri is not registered");
    }
    if (responseType !== "code") {
      throw safeError("INVALID_CLIENT", "response_type must be code");
    }
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      throw safeError("PKCE_VALIDATION_FAILED", "PKCE S256 is required");
    }
    if (resource !== this.config.mcpResourceUrl) {
      throw safeError("INVALID_TOKEN", "resource must match MCP resource URL");
    }
    scopeList(scope);
  }

  private restoreChatGptClient(clientId: string, redirectUri: string): OAuthClient | undefined {
    if (!isRestorableClientId(clientId) || !isSafeRedirectUri(redirectUri)) {
      return undefined;
    }

    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      return undefined;
    }
    if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") {
      return undefined;
    }

    const client: OAuthClient = {
      id: id("clirow"),
      clientId,
      clientName: "Restored ChatGPT Connector",
      redirectUris: [redirectUri],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      createdAt: nowIso(),
    };
    this.store.insertClient(client);
    this.audit({
      eventType: "oauth_client_restored",
      severity: "info",
      metadata: { client_id: client.clientId, redirect_uri_host: url.hostname },
    });
    return client;
  }

  private addChatGptRedirectUri(client: OAuthClient, redirectUri: string): OAuthClient | undefined {
    if (!isSafeRedirectUri(redirectUri)) {
      return undefined;
    }
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      return undefined;
    }
    if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") {
      return undefined;
    }
    const updatedUris = [...client.redirectUris, redirectUri];
    this.store.updateClientRedirectUris(client.clientId, updatedUris);
    this.audit({
      eventType: "oauth_client_restored",
      severity: "info",
      metadata: { client_id: client.clientId, redirect_uri_host: url.hostname },
    });
    return { ...client, redirectUris: updatedUris };
  }
}
