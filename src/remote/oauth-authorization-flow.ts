import type { IncomingMessage, ServerResponse } from "node:http";
import { escape as escapeHtml } from "html-escaper";
import { URL } from "node:url";
import { hashSecret, id, nowIso, randomToken } from "./crypto.js";
import {
  asString,
  isSafeRedirectUri,
  readJsonOrForm,
  redirect,
  safeError,
  scopeList,
} from "./http-util.js";
import type { RemoteStore } from "./store.js";
import type { ReviewerSessionHandler } from "./reviewer-session.js";
import type {
  AuditEvent,
  GitHubUser,
  GoogleUser,
  OAuthAuthorizationCode,
  OAuthClient,
  RemoteConfig,
} from "./types.js";
import { REVIEWER_DEMO_SCOPES, REVIEWER_DEMO_USER_ID } from "./types.js";
import { continueBrowserNavigation } from "./oauth-browser-navigation.js";

/** Minimal inspection grant available even when an AI client requests elevated scopes. */
const READ_ONLY_CONSENT_SCOPES = REVIEWER_DEMO_SCOPES;

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

type AuthorizationIdentity = {
  testGitHubUser: () => GitHubUser | undefined;
  testGoogleUser: () => GoogleUser | undefined;
  fetchGitHubUser: (code: string) => Promise<GitHubUser>;
  fetchGoogleUser: (code: string) => Promise<GoogleUser>;
  upsertGitHubUser: (user: GitHubUser) => { id: string };
  upsertGoogleUser: (user: GoogleUser) => { id: string };
};

export class OAuthAuthorizationFlow {
  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
    private readonly authorizeTransactions: Map<string, PendingAuthorize>,
    private readonly reviewerSessions: ReviewerSessionHandler,
    private readonly identity: AuthorizationIdentity,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {}

  private isReviewerEnabled(): boolean {
    return this.reviewerSessions.isEnabled();
  }

  private transactionCookie(value: string): string {
    const secure = this.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `ssh_mcp_oauth_tx=${value}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=300${secure}`;
  }

  private matchingBrowser(req: IncomingMessage, transactionId: string): boolean {
    return (req.headers.cookie ?? "")
      .split(";")
      .some((part) => part.trim() === `ssh_mcp_oauth_tx=${transactionId}`);
  }

  /** A consent choice must never add scopes not requested by the client. */
  private readOnlyConsentScope(requested: string): string | undefined {
    const requestedScopes = scopeList(requested);
    const readScopes = READ_ONLY_CONSENT_SCOPES.filter((entry) => requestedScopes.includes(entry));
    return readScopes.length > 0 && readScopes.length < requestedScopes.length
      ? readScopes.join(" ")
      : undefined;
  }

  private reviewerConsentScope(requested: string): string | undefined {
    const requestedScopes = scopeList(requested);
    const reviewerScopes = REVIEWER_DEMO_SCOPES.filter((entry) => requestedScopes.includes(entry));
    return reviewerScopes.length > 0 ? reviewerScopes.join(" ") : undefined;
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

    const reviewerUserId = this.reviewerSessions.getUserId(req);
    const reviewerSession = reviewerUserId === REVIEWER_DEMO_USER_ID;
    const pending: PendingAuthorize = {
      clientId,
      redirectUri,
      codeChallenge,
      resource,
      scope,
      state,
      expiresAt: Date.now() + this.config.authCodeTtlSeconds * 1000,
    };
    if (reviewerSession) {
      const reviewerScope = this.reviewerConsentScope(scope);
      if (!reviewerScope) {
        throw safeError(
          "INVALID_SCOPE",
          "Reviewer sandbox only supports read-only inspection scopes",
          403,
        );
      }
      pending.scope = reviewerScope;
    }

    if (this.maybeAuthorizeTestIdentity(pending, res, redirectUri, state)) return;
    this.renderAuthorizeConsent(res, url, pending, reviewerSession, scope, redirectUri);
  }

  private maybeAuthorizeTestIdentity(
    pending: PendingAuthorize,
    res: ServerResponse,
    redirectUri: string,
    state: string,
  ): boolean {
    const testUser = this.identity.testGitHubUser();
    if (testUser) {
      const user = this.identity.upsertGitHubUser(testUser);
      const code = this.issueAuthorizationCode(pending, user.id);
      const destination = new URL(redirectUri);
      destination.searchParams.set("code", code);
      destination.searchParams.set("iss", this.config.publicBaseUrl);
      if (state) {
        destination.searchParams.set("state", state);
      }
      redirect(res, destination.toString());
      return true;
    }

    const testGoogle = this.identity.testGoogleUser();
    if (testGoogle) {
      const user = this.identity.upsertGoogleUser(testGoogle);
      const code = this.issueAuthorizationCode(pending, user.id);
      const destination = new URL(redirectUri);
      destination.searchParams.set("code", code);
      destination.searchParams.set("iss", this.config.publicBaseUrl);
      if (state) {
        destination.searchParams.set("state", state);
      }
      redirect(res, destination.toString());
      return true;
    }

    return false;
  }

  private consentPermissions(
    reviewerSession: boolean,
    pendingScope: string,
    readOnlyScope: string | undefined,
    scope: string,
  ): string {
    if (reviewerSession) {
      return [
        '<p><span class="badge">Review sandbox — synthetic data only</span></p>',
        "<p>Only sample devices and synthetic system status are available. Real devices and actions are inaccessible.</p>",
        '<p><span class="scope-preview">',
        escapeHtml(pendingScope),
        "</span></p>",
        '<input type="hidden" name="grant_mode" value="read_only">',
      ].join("");
    }
    if (readOnlyScope) {
      return [
        '<p class="device-scope-note">After connecting, select the devices this AI can access under AI clients in your workspace. New connections start without shared devices.</p>',
        '<fieldset class="permission-options"><legend>Choose access level</legend>',
        '<label class="permission-option"><input type="radio" name="grant_mode" value="read_only" checked>',
        '<span class="permission-copy"><strong>Read-only inspection (recommended)</strong>',
        "<small>List hosts, connected devices, and system status. No file changes, commands, or administrator access.</small>",
        '<small class="scope-preview">',
        escapeHtml(readOnlyScope),
        "</small></span></label>",
        '<label class="permission-option"><input type="radio" name="grant_mode" value="requested">',
        '<span class="permission-copy"><strong>All requested permissions</strong>',
        "<small>Includes sensitive actions such as file changes and command execution when requested by the client. Grant only if you trust it.</small>",
        '<small class="scope-preview">',
        escapeHtml(scope),
        "</small></span></label></fieldset>",
      ].join("");
    }
    return [
      '<p class="device-scope-note">After connecting, choose which devices this AI may use in your workspace. New connections start without shared devices.</p>',
      '<p><span class="badge">',
      escapeHtml(scope),
      "</span></p>",
      '<input type="hidden" name="grant_mode" value="requested">',
    ].join("");
  }

  private consentProviderButtons(
    url: URL,
    reviewerSession: boolean,
    hasGoogle: boolean,
    hasGitHub: boolean,
  ): string[] {
    const buttons = [];
    if (reviewerSession) {
      buttons.push(
        '<button type="submit" name="provider" value="reviewer_demo" style="display:flex;align-items:center;justify-content:center;width:100%;padding:12px;margin-bottom:10px;background:#3978d6;color:#ffffff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Continue with reviewer sandbox</button>',
      );
    } else if (hasGoogle) {
      buttons.push(
        `<button type="submit" name="provider" value="google" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;margin-bottom:10px;background:#ffffff;color:#1f2937;border:1px solid #d1d5db;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.7 0 3 .7 3.9 1.5l2.9-2.9C17 2 14.7 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.5 1.9 7.8l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.3 7.5 23.5 12 23.5z"/></svg>
          Continue with Google
        </button>`,
      );
    }
    if (!reviewerSession && hasGitHub) {
      buttons.push(
        `<button type="submit" name="provider" value="github" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;margin-bottom:10px;background:#24292f;color:#ffffff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          Continue with GitHub
        </button>`,
      );
    }
    if (!reviewerSession && this.isReviewerEnabled()) {
      const reviewerLoginUrl = new URL("/oauth/reviewer/login", this.config.publicBaseUrl);
      reviewerLoginUrl.searchParams.set("return_to", `${url.pathname}${url.search}`);
      const loginHref = escapeHtml(reviewerLoginUrl.pathname + reviewerLoginUrl.search);
      buttons.push(
        ['<p><a href="', loginHref, '">Sign in to the OpenAI reviewer sandbox</a></p>'].join(""),
      );
    }
    return buttons;
  }

  private renderAuthorizeConsent(
    res: ServerResponse,
    url: URL,
    pending: PendingAuthorize,
    reviewerSession: boolean,
    scope: string,
    redirectUri: string,
  ): void {
    const hasGitHub = Boolean(this.config.githubClientId && this.config.githubClientSecret);
    const hasGoogle = Boolean(this.config.googleClientId && this.config.googleClientSecret);

    if (!hasGitHub && !hasGoogle && !reviewerSession && !this.isReviewerEnabled()) {
      throw safeError(
        "FORBIDDEN",
        "Neither GitHub nor Google OAuth nor reviewer access is configured",
        503,
      );
    }

    const transactionId = id("code");
    this.authorizeTransactions.set(transactionId, pending);
    const hostname = escapeHtml(new URL(redirectUri).hostname);
    const readOnlyScope = reviewerSession ? pending.scope : this.readOnlyConsentScope(scope);
    const permissions = this.consentPermissions(
      reviewerSession,
      pending.scope,
      readOnlyScope,
      scope,
    );
    // Chromium also checks form-action on the redirect after POST /oauth/approve.
    // Permit only the configured identity providers, not arbitrary OAuth clients.
    const formActions = [
      "'self'",
      ...(!reviewerSession && hasGoogle ? ["https://accounts.google.com"] : []),
      ...(!reviewerSession && hasGitHub ? ["https://github.com"] : []),
    ].join(" ");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formActions}; frame-ancestors 'none'; base-uri 'none'`,
      "X-Content-Type-Options": "nosniff",
      "Set-Cookie": this.transactionCookie(transactionId),
    });

    const buttons = this.consentProviderButtons(url, reviewerSession, hasGoogle, hasGitHub);

    res.end(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorize ssh-mcp-pro</title>',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<style>body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;}',
        ".card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.5);text-align:center;}",
        "h1{font-size:22px;margin:0 0 12px;color:#f0f6fc;}p{font-size:14px;color:#8b949e;line-height:1.5;margin:0 0 24px;}",
        ".badge{background:#21262d;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-family:monospace;font-size:12px;color:#58a6ff;}",
        ".permission-options{border:0;padding:0;margin:0 0 18px;text-align:left;min-width:0;}.permission-options legend{font-size:14px;font-weight:600;color:#f0f6fc;margin-bottom:10px;}.permission-option{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #30363d;border-radius:8px;margin-bottom:10px;cursor:pointer;}.permission-option:focus-within{border-color:#58a6ff;}.permission-option input{accent-color:#58a6ff;margin-top:3px;}.permission-copy{display:flex;flex-direction:column;gap:5px;min-width:0;color:#e6edf3;font-size:14px;}.permission-copy small{color:#a8b4c2;font-size:12px;line-height:1.5;overflow-wrap:anywhere;}.permission-copy .scope-preview{color:#79c0ff;font-family:monospace;}",
        "</style></head><body>",
        '<div class="card">',
        '<div style="margin-bottom:16px;"><span style="font-size:32px;">🔐</span></div>',
        "<h1>Authorize ssh-mcp-pro</h1>",
        '<p>Allow client at <strong style="color:#f0f6fc;">',
        hostname,
        "</strong> to access your account:</p>",
        '<form method="post" action="/oauth/approve"><input type="hidden" name="transaction" value="',
        escapeHtml(transactionId),
        '">',
        permissions,
        buttons.join(""),
        "</form>",
        '<div style="font-size:12px;color:#484f58;margin-top:20px;">Zero-Trust SSH Model Context Protocol Gateway</div>',
        "</div></body></html>",
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
    if (pending.approved) {
      throw safeError("INVALID_TOKEN", "OAuth transaction is already approved", 403);
    }
    if (provider === "reviewer_demo") {
      this.approveReviewerConsent(req, res, pending, transactionId);
      return;
    }
    const grantMode =
      form.grant_mode ?? (this.readOnlyConsentScope(pending.scope) ? "read_only" : "requested");
    if (grantMode === "read_only") {
      const narrowed = this.readOnlyConsentScope(pending.scope);
      if (!narrowed) {
        throw safeError("INVALID_SCOPE", "Read-only consent is not available", 400);
      }
      pending.scope = narrowed;
    } else if (grantMode !== "requested") {
      throw safeError("INVALID_SCOPE", "Invalid access level", 400);
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
      continueBrowserNavigation(res, googleUrl, "Google");
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
    continueBrowserNavigation(res, githubUrl, "GitHub");
  }

  private approveReviewerConsent(
    req: IncomingMessage,
    res: ServerResponse,
    pending: PendingAuthorize,
    transactionId: string,
  ): void {
    const userId = this.reviewerSessions.getUserId(req);
    if (
      userId !== REVIEWER_DEMO_USER_ID ||
      req.headers.origin !== new URL(this.config.publicBaseUrl).origin
    ) {
      throw safeError("FORBIDDEN", "Reviewer session is missing or expired", 403);
    }
    const reviewerScope = this.reviewerConsentScope(pending.scope);
    if (!reviewerScope) {
      throw safeError(
        "INVALID_SCOPE",
        "Reviewer sandbox only supports read-only inspection scopes",
        403,
      );
    }
    pending.scope = reviewerScope;
    pending.approved = true;
    this.completeOAuthCallback(res, pending, userId);
    this.authorizeTransactions.delete(transactionId);
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
    continueBrowserNavigation(res, destination, "MCP client");
  }

  /** GET /oauth/callback/github */
  async handleGitHubCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { code, pending } = this.consumeOAuthCallback(req, "github");
    const user = this.identity.upsertGitHubUser(await this.identity.fetchGitHubUser(code));
    this.completeOAuthCallback(res, pending, user.id);
  }

  /** GET /oauth/callback/google */
  async handleGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { code, pending } = this.consumeOAuthCallback(req, "google");
    const user = this.identity.upsertGoogleUser(await this.identity.fetchGoogleUser(code));
    this.completeOAuthCallback(res, pending, user.id);
  }

  private issueAuthorizationCode(pending: PendingAuthorize, userId: string): string {
    const code = randomToken(32);
    const now = nowIso();
    const record: OAuthAuthorizationCode = {
      id: id("code"),
      codeHash: hashSecret(code),
      clientId: pending.clientId,
      userId,
      connectionId: this.store.createOAuthConnection(userId, pending.clientId, now),
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
}
