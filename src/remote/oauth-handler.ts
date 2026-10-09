import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  hashSecret,
  id,
  issueAccessToken,
  nowIso,
  publicJwkFromPem,
  randomToken,
  type JwtKeyPair,
} from "./crypto.js";
import {
  asString,
  asStringArray,
  addNoStore,
  isSafeRedirectUri,
  pkceChallenge,
  readJson,
  readJsonOrForm,
  redirect,
  safeError,
  scopeList,
} from "./http-util.js";
import { RemoteStore } from "./store.js";
import type {
  AuditEvent,
  GitHubUser,
  OAuthAuthorizationCode,
  OAuthClient,
  RemoteConfig,
} from "./types.js";
import { REMOTE_SCOPES } from "./types.js";
import { jsonResponse } from "./util.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Pending OAuth authorization transaction. */
export interface PendingAuthorize {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state: string;
  expiresAt: number;
  approved?: boolean;
}

/** Handles OAuth 2.0 authorization code flow with PKCE and GitHub identity. */
export class OAuthHandler {
  private readonly registrationAttempts = new Map<string, { count: number; expiresAt: number }>();

  private transactionCookie(value: string): string {
    const secure = this.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `ssh_mcp_oauth_tx=${value}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=300${secure}`;
  }

  private matchingBrowser(req: IncomingMessage, transactionId: string): boolean {
    return (req.headers.cookie ?? "")
      .split(";")
      .some((part) => part.trim() === `ssh_mcp_oauth_tx=${transactionId}`);
  }

  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
    private readonly authorizeTransactions: Map<string, PendingAuthorize>,
    private readonly getJwtKeyPair: () => JwtKeyPair,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {}

  /** GET /.well-known/oauth-protected-resource */
  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.config.mcpResourceUrl,
      resource_name: "SshAutomator MCP",
      authorization_servers: [this.config.publicBaseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: REMOTE_SCOPES,
    };
  }

  /** GET /.well-known/oauth-authorization-server */
  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.publicBaseUrl,
      authorization_endpoint: `${this.config.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${this.config.publicBaseUrl}/oauth/token`,
      registration_endpoint: `${this.config.publicBaseUrl}/oauth/register`,
      jwks_uri: `${this.config.publicBaseUrl}/oauth/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: REMOTE_SCOPES,
    };
  }

  /** POST /oauth/register */
  async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const redirectUris = asStringArray(body.redirect_uris);
    if (redirectUris.length === 0 || redirectUris.some((uri) => !isSafeRedirectUri(uri))) {
      throw safeError(
        "INVALID_REDIRECT_URI",
        "redirect_uris must contain HTTPS URLs or localhost HTTP URLs",
      );
    }
    // Bound unauthenticated DCR registration by the TCP peer, not spoofable proxy headers.
    const peer = req.socket?.remoteAddress ?? "local-test";
    const nowMs = Date.now();
    const previous = this.registrationAttempts.get(peer);
    const window =
      previous && previous.expiresAt > nowMs ? previous : { count: 0, expiresAt: nowMs + 300_000 };
    if (window.count >= 20) {
      throw safeError("FORBIDDEN", "OAuth client registration rate limit reached", 429);
    }
    window.count++;
    this.registrationAttempts.set(peer, window);
    if (this.store.countOAuthClients() >= this.config.maxOAuthClients) {
      throw safeError("FORBIDDEN", "OAuth client registration limit reached", 429);
    }
    const now = nowIso();
    const client: OAuthClient = {
      id: id("clirow"),
      clientId: id("cli"),
      clientName: asString(body.client_name) ?? "ChatGPT Connector",
      redirectUris,
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      createdAt: now,
    };
    this.store.insertClient(client);
    this.audit({
      eventType: "oauth_client_registered",
      severity: "info",
      metadata: { client_id: client.clientId, redirect_uri_count: redirectUris.length },
    });
    jsonResponse(
      res,
      201,
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: client.responseTypes,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      },
      addNoStore(),
    );
  }

  /** GET /oauth/authorize */
  async handleAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/oauth/authorize", this.config.publicBaseUrl);
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const responseType = url.searchParams.get("response_type") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const resource = url.searchParams.get("resource") ?? this.config.mcpResourceUrl;
    const scope = url.searchParams.get("scope") ?? "hosts:read agents:read status:read logs:read";

    this.validateAuthorizeParams(
      clientId,
      redirectUri,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      resource,
      scope,
    );

    const pending: PendingAuthorize = {
      clientId,
      redirectUri,
      codeChallenge,
      resource,
      scope,
      state,
      expiresAt: Date.now() + this.config.authCodeTtlSeconds * 1000,
    };

    const testUser = this.testGitHubUser();
    if (testUser) {
      const user = this.upsertGitHubUser(testUser);
      const code = this.issueAuthorizationCode(pending, user.id);
      const destination = new URL(redirectUri);
      destination.searchParams.set("code", code);
      if (state) {
        destination.searchParams.set("state", state);
      }
      redirect(res, destination.toString());
      return;
    }

    if (!this.config.githubClientId || !this.config.githubClientSecret) {
      throw safeError("FORBIDDEN", "GitHub OAuth is not configured", 503);
    }

    const transactionId = id("code");
    this.authorizeTransactions.set(transactionId, pending);
    const hostname = escapeHtml(new URL(redirectUri).hostname);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
      "Set-Cookie": this.transactionCookie(transactionId),
    });
    res.end(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorize SSH MCP</title></head>',
        "<body><h1>Authorize SSH MCP</h1><p>Allow the client at ",
        hostname,
        " to request: ",
        escapeHtml(scope),
        '?</p><form method="post" action="/oauth/approve"><input type="hidden" name="transaction" value="',
        escapeHtml(transactionId),
        '"><button type="submit">Continue with GitHub</button></form></body></html>',
      ].join(""),
    );
  }

  /** Explicit browser approval binds this client to the current login transaction. */
  async handleApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await readJsonOrForm(req);
    const transactionId = form.transaction ?? "";
    const pending = this.authorizeTransactions.get(transactionId);
    if (!pending || pending.expiresAt < Date.now() || !this.matchingBrowser(req, transactionId)) {
      throw safeError("INVALID_TOKEN", "OAuth transaction is missing or expired", 403);
    }
    if (!this.config.githubClientId || !this.config.githubClientSecret) {
      throw safeError("FORBIDDEN", "GitHub OAuth is not configured", 503);
    }
    pending.approved = true;
    const githubUrl = new URL("https://github.com/login/oauth/authorize");
    githubUrl.searchParams.set("client_id", this.config.githubClientId);
    githubUrl.searchParams.set("redirect_uri", this.config.githubCallbackUrl);
    githubUrl.searchParams.set("scope", "read:user");
    githubUrl.searchParams.set("state", transactionId);
    redirect(res, githubUrl.toString());
  }

  private validateAuthorizeParams(
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
    if (!/^cli_[A-Za-z0-9_-]+$/u.test(clientId) || !isSafeRedirectUri(redirectUri)) {
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
      grantTypes: ["authorization_code"],
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

  /** GET /oauth/callback/github */
  async handleGitHubCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/oauth/callback/github", this.config.publicBaseUrl);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const pending = this.authorizeTransactions.get(state);
    this.authorizeTransactions.delete(state);
    if (
      !code ||
      !pending?.approved ||
      pending.expiresAt < Date.now() ||
      !this.matchingBrowser(req, state)
    ) {
      throw safeError("INVALID_TOKEN", "OAuth transaction is missing or expired");
    }
    const githubUser = await this.fetchGitHubUser(code);
    const user = this.upsertGitHubUser(githubUser);
    const authCode = this.issueAuthorizationCode(pending, user.id);
    const destination = new URL(pending.redirectUri);
    destination.searchParams.set("code", authCode);
    if (pending.state) {
      destination.searchParams.set("state", pending.state);
    }
    res.setHeader("Set-Cookie", this.transactionCookie("").replace("Max-Age=300", "Max-Age=0"));
    redirect(res, destination.toString());
  }

  private async fetchGitHubUser(code: string): Promise<GitHubUser> {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.githubClientId,
        client_secret: this.config.githubClientSecret,
        code,
        redirect_uri: this.config.githubCallbackUrl,
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
    return { id: String(userPayload.id ?? ""), login: String(userPayload.login ?? "") };
  }

  private testGitHubUser(): GitHubUser | undefined {
    const idValue = process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
    const login = process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
    return idValue && login ? { id: idValue, login } : undefined;
  }

  private upsertGitHubUser(githubUser: GitHubUser): {
    id: string;
    githubId: string;
    githubLogin: string;
  } {
    if (!this.isGitHubUserAllowed(githubUser)) {
      throw safeError("FORBIDDEN", "GitHub user is not allowed");
    }
    const existing = this.store.getUserByGitHubId(githubUser.id);
    const internalId = existing?.id ?? `github:${githubUser.id}`;
    this.store.upsertUser({ ...githubUser, internalId, now: nowIso() });
    this.audit({
      userId: internalId,
      eventType: "user_login",
      severity: "info",
      metadata: { github_id: githubUser.id, github_login: githubUser.login },
    });
    return { id: internalId, githubId: githubUser.id, githubLogin: githubUser.login };
  }

  private isGitHubUserAllowed(user: GitHubUser): boolean {
    return (
      this.config.allowAllUsers ||
      this.config.allowedGitHubIds.includes(user.id) ||
      this.config.allowedGitHubLogins.includes(user.login)
    );
  }

  private issueAuthorizationCode(pending: PendingAuthorize, userId: string): string {
    const code = randomToken(32);
    const now = nowIso();
    const record: OAuthAuthorizationCode = {
      id: id("code"),
      codeHash: hashSecret(code),
      clientId: pending.clientId,
      userId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: "S256",
      resource: pending.resource,
      scope: pending.scope,
      expiresAt: new Date(Date.now() + this.config.authCodeTtlSeconds * 1000).toISOString(),
      createdAt: now,
    };
    this.store.insertAuthorizationCode(record);
    return code;
  }

  /** POST /oauth/token */
  async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonOrForm(req);
    if (body.grant_type !== "authorization_code") {
      throw safeError("INVALID_CLIENT", "grant_type must be authorization_code");
    }
    const clientId = body.client_id ?? "";
    const client = this.store.getClient(clientId);
    if (!client) {
      throw safeError("INVALID_CLIENT", "Unknown client_id");
    }
    const code = body.code ?? "";
    const redirectUri = body.redirect_uri ?? "";
    const verifier = body.code_verifier ?? "";
    const codeRecord = this.store.getAuthorizationCodeByHash(hashSecret(code));
    if (codeRecord?.clientId !== clientId || codeRecord?.redirectUri !== redirectUri) {
      throw safeError("INVALID_TOKEN", "Invalid authorization code");
    }
    if (codeRecord.usedAt || new Date(codeRecord.expiresAt).getTime() < Date.now()) {
      throw safeError("INVALID_TOKEN", "Authorization code is expired or already used");
    }
    if (!verifier || pkceChallenge(verifier) !== codeRecord.codeChallenge) {
      throw safeError("PKCE_VALIDATION_FAILED", "Invalid PKCE code_verifier");
    }
    const jwtKeyPair = this.getJwtKeyPair();
    const user = this.userFromId(codeRecord.userId);
    const scopes = scopeList(codeRecord.scope);
    try {
      this.store.markAuthorizationCodeUsed(codeRecord.codeHash, nowIso());
    } catch {
      throw safeError("INVALID_TOKEN", "Authorization code is expired or already used");
    }
    const token = await issueAccessToken(this.config, jwtKeyPair, user, scopes);
    jsonResponse(
      res,
      200,
      {
        access_token: token.token,
        token_type: "Bearer",
        expires_in: this.config.accessTokenTtlSeconds,
        scope: scopes.join(" "),
      },
      addNoStore(),
    );
  }

  private userFromId(userId: string): { id: string; githubId: string; githubLogin: string } {
    if (userId.startsWith("github:")) {
      const githubId = userId.slice("github:".length);
      const user = this.store.getUserByGitHubId(githubId);
      if (user) {
        return user;
      }
    }
    throw safeError("UNAUTHORIZED", "User no longer exists", 401);
  }

  /** Remove expired pending authorization transactions. */
  cleanupExpired(now = Date.now()): void {
    for (const [peer, entry] of this.registrationAttempts) {
      if (entry.expiresAt <= now) this.registrationAttempts.delete(peer);
    }
    for (const [transactionId, transaction] of this.authorizeTransactions.entries()) {
      if (transaction.expiresAt <= now) {
        this.authorizeTransactions.delete(transactionId);
      }
    }
  }

  /** GET /oauth/jwks.json */
  async handleJwks(res: ServerResponse): Promise<void> {
    const jwtKeyPair = this.getJwtKeyPair();
    jsonResponse(
      res,
      200,
      { keys: [await publicJwkFromPem(jwtKeyPair.publicKeyPem)] },
      addNoStore(),
    );
  }
}
