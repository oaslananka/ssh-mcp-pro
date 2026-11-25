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
  safeError,
  scopeList,
} from "./http-util.js";
import { RemoteStore } from "./store.js";
import { ReviewerSessionHandler } from "./reviewer-session.js";
import { OAuthAuthorizationFlow, type PendingAuthorize } from "./oauth-authorization-flow.js";
import { isReviewerScopeSubset } from "./scopes.js";
import { exchangeGitHubIdentity, exchangeGoogleIdentity } from "./oauth-provider-exchange.js";
import type {
  AuditEvent,
  GitHubUser,
  GoogleUser,
  OAuthClient,
  OAuthRefreshTokenRecord,
  RemoteScope,
  RemoteConfig,
} from "./types.js";
import { PUBLIC_REMOTE_SCOPES, REVIEWER_DEMO_USER_ID } from "./types.js";
import { jsonResponse } from "./util.js";

export type { PendingAuthorize } from "./oauth-authorization-flow.js";

/** Handles OAuth 2.0 authorization code flow with PKCE and GitHub identity. */
export class OAuthHandler {
  private readonly registrationAttempts = new Map<string, { count: number; expiresAt: number }>();
  private readonly refreshTokenResponseField = "refresh_token";
  private readonly reviewerSessions: ReviewerSessionHandler;
  private readonly authorizationFlow: OAuthAuthorizationFlow;

  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
    private readonly authorizeTransactions: Map<string, PendingAuthorize>,
    private readonly getJwtKeyPair: () => JwtKeyPair,
    private readonly audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void,
  ) {
    this.reviewerSessions = new ReviewerSessionHandler(config, store);
    this.authorizationFlow = new OAuthAuthorizationFlow(
      config,
      store,
      authorizeTransactions,
      this.reviewerSessions,
      {
        testGitHubUser: () => this.testGitHubUser(),
        testGoogleUser: () => this.testGoogleUser(),
        fetchGitHubUser: (code) => this.fetchGitHubUser(code),
        fetchGoogleUser: (code) => this.fetchGoogleUser(code),
        upsertGitHubUser: (user) => this.upsertGitHubUser(user),
        upsertGoogleUser: (user) => this.upsertGoogleUser(user),
      },
      audit,
    );
  }

  isReviewerEnabled(): boolean {
    return this.reviewerSessions.isEnabled();
  }

  handleReviewerLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.reviewerSessions.handleLogin(req, res);
  }

  handleReviewerLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.reviewerSessions.handleLogout(req, res);
  }

  private isReviewerGrantAllowed(
    user: { id: string; provider?: "github" | "google" | "demo" | undefined },
    scopes: readonly RemoteScope[],
  ): boolean {
    const reviewerIdentity = user.id === REVIEWER_DEMO_USER_ID || user.provider === "demo";
    return (
      !reviewerIdentity ||
      (user.id === REVIEWER_DEMO_USER_ID &&
        user.provider === "demo" &&
        this.isReviewerEnabled() &&
        isReviewerScopeSubset(scopes))
    );
  }

  /** GET /.well-known/oauth-protected-resource */
  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.config.mcpResourceUrl,
      resource_name: "ssh-mcp-pro",
      authorization_servers: [this.config.publicBaseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: PUBLIC_REMOTE_SCOPES,
    };
  }

  /** GET /.well-known/oauth-authorization-server */
  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.publicBaseUrl,
      authorization_response_iss_parameter_supported: true,
      authorization_endpoint: `${this.config.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${this.config.publicBaseUrl}/oauth/token`,
      revocation_endpoint: `${this.config.publicBaseUrl}/oauth/revoke`,
      registration_endpoint: `${this.config.publicBaseUrl}/oauth/register`,
      jwks_uri: `${this.config.publicBaseUrl}/oauth/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: PUBLIC_REMOTE_SCOPES,
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
    const grantTypes =
      body.grant_types === undefined
        ? ["authorization_code", "refresh_token"]
        : asStringArray(body.grant_types);
    if (
      (!Array.isArray(body.grant_types) && body.grant_types !== undefined) ||
      !grantTypes.includes("authorization_code") ||
      grantTypes.some((grant) => !["authorization_code", "refresh_token"].includes(grant)) ||
      new Set(grantTypes).size !== grantTypes.length
    ) {
      throw safeError("INVALID_CLIENT", "Unsupported OAuth grant_types");
    }
    const now = nowIso();
    const client: OAuthClient = {
      id: id("clirow"),
      clientId: id("cli"),
      clientName: asString(body.client_name) ?? "MCP Client",
      redirectUris,
      grantTypes,
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

  async handleAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.authorizationFlow.handleAuthorize(req, res);
  }

  async handleApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.authorizationFlow.handleApprove(req, res);
  }

  async handleGitHubCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.authorizationFlow.handleGitHubCallback(req, res);
  }

  async handleGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.authorizationFlow.handleGoogleCallback(req, res);
  }

  async fetchGoogleUser(code: string): Promise<GoogleUser> {
    const testUser = this.testGoogleUser();
    if (testUser) return testUser;
    return exchangeGoogleIdentity(this.config, code);
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
    return exchangeGitHubIdentity(this.config, code);
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

  /** Explicit OAuth revocation; RFC 7009 never reveals token validity. */
  async handleRevoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonOrForm(req);
    const token = body.token ?? "";
    const clientId = body.client_id ?? "";
    if (/^[a-zA-Z0-9_-]{32,128}$/u.test(token) && clientId) {
      this.store.revokeRefreshFamily(hashSecret(token), clientId, nowIso());
    }
    res.writeHead(200, { "Cache-Control": "no-store", Pragma: "no-cache" });
    res.end();
  }

  /** POST /oauth/token */
  async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonOrForm(req);
    if (body.grant_type === "refresh_token") {
      await this.refreshAccessToken(res, body);
      return;
    }
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
    if (!this.isReviewerGrantAllowed(user, scopes)) {
      throw safeError("INVALID_TOKEN", "Reviewer authorization is no longer valid", 403);
    }
    try {
      this.store.markAuthorizationCodeUsed(codeRecord.codeHash, nowIso());
    } catch {
      throw safeError("INVALID_TOKEN", "Authorization code is expired or already used");
    }
    const connection = codeRecord.connectionId
      ? this.store.getOAuthConnection(codeRecord.userId, codeRecord.connectionId)
      : undefined;
    if (
      codeRecord.connectionId &&
      (connection?.clientId !== clientId || connection.status !== "active")
    ) {
      throw safeError("INVALID_TOKEN", "Authorization connection is no longer valid", 403);
    }
    if (
      !codeRecord.connectionId &&
      this.store.isStrictVisibilityEnabled(user.id) &&
      user.provider !== "demo"
    ) {
      throw safeError("INVALID_TOKEN", "Reconnect to select authorized devices", 403);
    }
    const token = await issueAccessToken(
      this.config,
      jwtKeyPair,
      user,
      scopes,
      connection ? { clientId, connectionId: connection.id } : undefined,
    );
    const refreshToken = client.grantTypes.includes("refresh_token") ? randomToken(32) : undefined;
    if (refreshToken) {
      this.store.createRefreshToken({
        tokenHash: hashSecret(refreshToken),
        familyId: id("refreshfam"),
        clientId,
        connectionId: codeRecord.connectionId,
        userId: codeRecord.userId,
        resource: codeRecord.resource,
        scope: scopes.join(" "),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: nowIso(),
      });
    }
    jsonResponse(
      res,
      200,
      {
        access_token: token.token,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        token_type: "Bearer",
        expires_in: this.config.accessTokenTtlSeconds,
        scope: scopes.join(" "),
      },
      addNoStore(),
    );
  }

  /** Rotate a bearer refresh token exactly once; all descendants die on replay. */
  private async refreshAccessToken(
    res: ServerResponse,
    body: Record<string, string>,
  ): Promise<void> {
    const clientId = body.client_id ?? "";
    const raw = body.refresh_token ?? "";
    const client = this.store.getClient(clientId);
    const invalidGrant = () => jsonResponse(res, 400, { error: "invalid_grant" }, addNoStore());
    if (
      !client ||
      !client.grantTypes.includes("refresh_token") ||
      !/^[a-zA-Z0-9_-]{32,128}$/u.test(raw)
    ) {
      invalidGrant();
      return;
    }
    const old = this.store.getRefreshTokenByHash(hashSecret(raw));
    if (!old) {
      invalidGrant();
      return;
    }
    if (old.clientId !== clientId || old.resource !== this.config.mcpResourceUrl) {
      invalidGrant();
      return;
    }
    const now = nowIso();
    if (old.expiresAt <= now || old.revokedAt) {
      invalidGrant();
      return;
    }
    const user = this.userFromId(old.userId);
    if (
      (user.githubId &&
        !this.isGitHubUserAllowed({ id: user.githubId, login: user.githubLogin ?? "" })) ||
      (user.googleId &&
        !this.isGoogleUserAllowed({
          id: user.googleId,
          email: user.email ?? "",
          name: user.displayName ?? "",
        }))
    ) {
      invalidGrant();
      return;
    }
    const scopes = scopeList(old.scope);
    if (!this.isReviewerGrantAllowed(user, scopes)) {
      invalidGrant();
      return;
    }
    const connection = old.connectionId
      ? this.store.getOAuthConnection(old.userId, old.connectionId)
      : undefined;
    if (
      (old.connectionId && (connection?.clientId !== clientId || connection.status !== "active")) ||
      (!old.connectionId &&
        this.store.isStrictVisibilityEnabled(old.userId) &&
        user.provider !== "demo")
    ) {
      invalidGrant();
      return;
    }
    const token = await issueAccessToken(
      this.config,
      this.getJwtKeyPair(),
      user,
      scopes,
      connection ? { clientId, connectionId: connection.id } : undefined,
    );
    const newRaw = randomToken(32);
    const successor: OAuthRefreshTokenRecord = {
      tokenHash: hashSecret(newRaw),
      familyId: old.familyId,
      clientId: old.clientId,
      connectionId: old.connectionId,
      userId: old.userId,
      resource: old.resource,
      scope: old.scope,
      expiresAt: old.expiresAt,
      createdAt: now,
    };
    if (!this.store.rotateRefreshToken(old.tokenHash, clientId, successor, now)) {
      invalidGrant();
      return;
    }
    jsonResponse(
      res,
      200,
      {
        access_token: token.token,
        [this.refreshTokenResponseField]: newRaw,
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
    provider?: "github" | "google" | "demo" | undefined;
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
