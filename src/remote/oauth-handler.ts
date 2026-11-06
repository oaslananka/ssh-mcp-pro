import type { IncomingMessage, ServerResponse } from "node:http";
import { escape as escapeHtml } from "html-escaper";
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
  GoogleUser,
  OAuthAuthorizationCode,
  OAuthClient,
  RemoteConfig,
} from "./types.js";
import { REMOTE_SCOPES } from "./types.js";
import { jsonResponse } from "./util.js";

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
      authorization_response_iss_parameter_supported: true,
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
      destination.searchParams.set("iss", this.config.publicBaseUrl);
      if (state) {
        destination.searchParams.set("state", state);
      }
      redirect(res, destination.toString());
      return;
    }

    const testGoogle = this.testGoogleUser();
    if (testGoogle) {
      const user = this.upsertGoogleUser(testGoogle);
      const code = this.issueAuthorizationCode(pending, user.id);
      const destination = new URL(redirectUri);
      destination.searchParams.set("code", code);
      destination.searchParams.set("iss", this.config.publicBaseUrl);
      if (state) {
        destination.searchParams.set("state", state);
      }
      redirect(res, destination.toString());
      return;
    }

    const hasGitHub = Boolean(this.config.githubClientId && this.config.githubClientSecret);
    const hasGoogle = Boolean(this.config.googleClientId && this.config.googleClientSecret);

    if (!hasGitHub && !hasGoogle) {
      throw safeError("FORBIDDEN", "Neither GitHub nor Google OAuth is configured", 503);
    }

    const transactionId = id("code");
    this.authorizeTransactions.set(transactionId, pending);
    const hostname = escapeHtml(new URL(redirectUri).hostname);
    // Chromium also checks form-action on the redirect after POST /oauth/approve.
    // Permit only the configured identity providers, not arbitrary OAuth clients.
    const formActions = [
      "'self'",
      ...(hasGoogle ? ["https://accounts.google.com"] : []),
      ...(hasGitHub ? ["https://github.com"] : []),
    ].join(" ");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formActions}; frame-ancestors 'none'; base-uri 'none'`,
      "X-Content-Type-Options": "nosniff",
      "Set-Cookie": this.transactionCookie(transactionId),
    });

    const buttons = [];
    if (hasGoogle) {
      buttons.push(
        `<button type="submit" name="provider" value="google" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;margin-bottom:10px;background:#ffffff;color:#1f2937;border:1px solid #d1d5db;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.7 0 3 .7 3.9 1.5l2.9-2.9C17 2 14.7 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.5 1.9 7.8l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.3 7.5 23.5 12 23.5z"/></svg>
          Continue with Google
        </button>`,
      );
    }
    if (hasGitHub) {
      buttons.push(
        `<button type="submit" name="provider" value="github" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;margin-bottom:10px;background:#24292f;color:#ffffff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          Continue with GitHub
        </button>`,
      );
    }

    res.end(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorize SSH MCP Pro</title>',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<style>body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;}',
        ".card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.5);text-align:center;}",
        "h1{font-size:22px;margin:0 0 12px;color:#f0f6fc;}p{font-size:14px;color:#8b949e;line-height:1.5;margin:0 0 24px;}",
        ".badge{background:#21262d;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-family:monospace;font-size:12px;color:#58a6ff;}",
        "</style></head><body>",
        '<div class="card">',
        '<div style="margin-bottom:16px;"><span style="font-size:32px;">🔐</span></div>',
        "<h1>Authorize SSH MCP Pro</h1>",
        '<p>Allow client at <strong style="color:#f0f6fc;">',
        hostname,
        "</strong> to request access to:</p>",
        '<p><span class="badge">',
        escapeHtml(scope),
        "</span></p>",
        '<form method="post" action="/oauth/approve"><input type="hidden" name="transaction" value="',
        escapeHtml(transactionId),
        '">',
        buttons.join(""),
        "</form>",
        '<div style="font-size:12px;color:#484f58;margin-top:20px;">Zero-Trust SSH Model Context Protocol Gateway</div>',
        "</div></body></html>",
      ].join(""),
    );
  }

  /**
   * Avoid chaining browser form submissions through third-party OAuth redirects
   * and then back to the MCP client. Chromium applies form-action to redirects;
   * the final client callback is deliberately not a permitted form destination.
   * A new document starts an ordinary navigation instead.
   */
  private continueToGitHub(res: ServerResponse, githubUrl: URL): void {
    const href = escapeHtml(githubUrl.toString());
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>Continue with GitHub — SSH MCP Pro</title>",
        `<meta http-equiv="refresh" content="0;url=${href}">`,
        "</head><body>",
        `<p>Continue to GitHub to sign in.</p><a href="${href}">Continue with GitHub</a>`,
        "</body></html>",
      ].join(""),
    );
  }

  /** Explicit browser approval binds this client to the current login transaction. */
  async handleApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await readJsonOrForm(req);
    const transactionId = form.transaction ?? "";
    const provider = asString(form.provider) ?? "github";
    const pending = this.authorizeTransactions.get(transactionId);
    if (!pending || pending.expiresAt < Date.now() || !this.matchingBrowser(req, transactionId)) {
      throw safeError("INVALID_TOKEN", "OAuth transaction is missing or expired", 403);
    }

    if (provider === "google") {
      if (!this.config.googleClientId || !this.config.googleClientSecret) {
        throw safeError("FORBIDDEN", "Google OAuth is not configured", 503);
      }
      pending.approved = true;
      const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      googleUrl.searchParams.set("client_id", this.config.googleClientId);
      googleUrl.searchParams.set("redirect_uri", this.config.googleCallbackUrl);
      googleUrl.searchParams.set("response_type", "code");
      googleUrl.searchParams.set("scope", "openid email profile");
      googleUrl.searchParams.set("state", transactionId);
      redirect(res, googleUrl.toString());
      return;
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
    this.continueToGitHub(res, githubUrl);
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

  /** Consume one-use OAuth transaction and preserve the associated PKCE request. */
  private consumeOAuthCallback(
    req: IncomingMessage,
    provider: "github" | "google",
  ): {
    code: string;
    pending: PendingAuthorize;
  } {
    const url = new URL(req.url ?? `/oauth/callback/${provider}`, this.config.publicBaseUrl);
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
    return { code, pending };
  }

  private completeOAuthCallback(
    res: ServerResponse,
    pending: PendingAuthorize,
    userId: string,
  ): void {
    const authCode = this.issueAuthorizationCode(pending, userId);
    const destination = new URL(pending.redirectUri);
    destination.searchParams.set("code", authCode);
    destination.searchParams.set("iss", this.config.publicBaseUrl);
    if (pending.state) destination.searchParams.set("state", pending.state);
    res.setHeader("Set-Cookie", this.transactionCookie("").replace("Max-Age=300", "Max-Age=0"));
    redirect(res, destination.toString());
  }

  /** GET /oauth/callback/github */
  async handleGitHubCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { code, pending } = this.consumeOAuthCallback(req, "github");
    const user = this.upsertGitHubUser(await this.fetchGitHubUser(code));
    this.completeOAuthCallback(res, pending, user.id);
  }

  /** GET /oauth/callback/google */
  async handleGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { code, pending } = this.consumeOAuthCallback(req, "google");
    const user = this.upsertGoogleUser(await this.fetchGoogleUser(code));
    this.completeOAuthCallback(res, pending, user.id);
  }

  async fetchGoogleUser(code: string): Promise<GoogleUser> {
    const testUser = this.testGoogleUser();
    if (testUser) {
      return testUser;
    }
    if (!this.config.googleClientId || !this.config.googleClientSecret) {
      throw safeError("FORBIDDEN", "Google OAuth is not configured", 503);
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: this.config.googleCallbackUrl,
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
    const googleSub = asString(userPayload.sub);
    const email = asString(userPayload.email);
    const name = asString(userPayload.name) ?? email ?? "Google User";
    const picture = asString(userPayload.picture);
    if (!googleSub || !email) {
      throw safeError("INVALID_TOKEN", "Google OAuth user response missing valid identity", 502);
    }
    return { id: googleSub, email, name, picture };
  }

  /** Fixture identities must never bypass provider login on public-facing hosts. */
  private allowFixtureIdentity(): boolean {
    if (process.env.NODE_ENV !== "test") return false;
    try {
      const baseUrl = new URL(this.config.publicBaseUrl);
      return (
        baseUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)
      );
    } catch {
      return false;
    }
  }

  testGoogleUser(): GoogleUser | undefined {
    if (!this.allowFixtureIdentity()) return undefined;
    const idValue = process.env.SSHAUTOMATOR_TEST_GOOGLE_ID;
    const email = process.env.SSHAUTOMATOR_TEST_GOOGLE_EMAIL;
    const name = process.env.SSHAUTOMATOR_TEST_GOOGLE_NAME ?? "Test Google User";
    return idValue && email ? { id: idValue, email, name } : undefined;
  }

  upsertGoogleUser(googleUser: GoogleUser): {
    id: string;
    googleId: string;
    email: string;
    displayName: string;
  } {
    if (!this.isGoogleUserAllowed(googleUser)) {
      throw safeError("FORBIDDEN", "Google user is not allowed");
    }
    const existing = this.store.getUserByGoogleId(googleUser.id);
    const internalId = existing?.id ?? `google:${googleUser.id}`;
    this.store.upsertGoogleUser({ ...googleUser, internalId, now: nowIso() });
    this.audit({
      userId: internalId,
      eventType: "user_login",
      severity: "info",
      metadata: { google_id: googleUser.id, email: googleUser.email, provider: "google" },
    });
    return {
      id: internalId,
      googleId: googleUser.id,
      email: googleUser.email,
      displayName: googleUser.name,
    };
  }

  isGoogleUserAllowed(user: GoogleUser): boolean {
    return (
      this.config.allowAllUsers ||
      this.config.allowedGoogleSubIds.includes(user.id) ||
      this.config.allowedGoogleEmails.includes(user.email)
    );
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
    const githubId = userPayload.id;
    const githubLogin = userPayload.login;
    if (
      typeof githubId !== "number" ||
      !Number.isSafeInteger(githubId) ||
      githubId <= 0 ||
      typeof githubLogin !== "string" ||
      !githubLogin
    ) {
      throw safeError("INVALID_TOKEN", "GitHub OAuth user response missing valid identity", 502);
    }
    return { id: String(githubId), login: githubLogin };
  }

  testGitHubUser(): GitHubUser | undefined {
    if (!this.allowFixtureIdentity()) return undefined;
    const idValue = process.env.SSHAUTOMATOR_TEST_GITHUB_ID;
    const login = process.env.SSHAUTOMATOR_TEST_GITHUB_LOGIN;
    return idValue && login ? { id: idValue, login } : undefined;
  }

  upsertGitHubUser(githubUser: GitHubUser): {
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

  private userFromId(userId: string): {
    id: string;
    githubId?: string | undefined;
    githubLogin?: string | undefined;
    googleId?: string | undefined;
    email?: string | undefined;
    displayName?: string | undefined;
    provider?: "github" | "google" | undefined;
  } {
    if (userId.startsWith("github:")) {
      const githubId = userId.slice("github:".length);
      const user = this.store.getUserByGitHubId(githubId);
      if (user) {
        return user;
      }
    }
    if (userId.startsWith("google:")) {
      const googleId = userId.slice("google:".length);
      const user = this.store.getUserByGoogleId(googleId);
      if (user) {
        return user;
      }
    }
    const user = this.store.getUserById(userId);
    if (user) {
      return user;
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
