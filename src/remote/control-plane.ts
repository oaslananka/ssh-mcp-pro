import { createPublicKey } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ensurePemKeyPair,
  hashSecret,
  id,
  issueAccessToken,
  keyId,
  loadJwtKeyPair,
  nowIso,
  publicJwkFromPem,
  randomToken,
  sha256Base64Url,
  signEnvelope,
  verifyEnvelope,
  verifyRemoteAccessToken,
  type JwtKeyPair,
  type PemKeyPair,
} from "./crypto.js";
import { loadRemoteConfig } from "./config.js";
import { listRemoteToolDescriptors } from "./mcp-tools.js";
import { createAgentPolicy, mergeCustomPolicy } from "./policy.js";
import {
  parseActionResultEnvelope,
  parseAgentHelloEnvelope,
  parseAgentHostMetadata,
} from "./schemas.js";
import { hasCapability, parseScopes } from "./scopes.js";
import { RemoteStore } from "./store.js";
import type {
  ActionRecord,
  ActionRequestEnvelope,
  ActionResultEnvelope,
  AgentHelloEnvelope,
  AuditEvent,
  GitHubUser,
  OAuthAuthorizationCode,
  OAuthClient,
  RemoteAgentRecord,
  RemoteConfig,
  RemoteErrorCode,
  RemotePrincipal,
  RemoteScope,
  RemoteToolName,
  PolicyUpdateEnvelope,
} from "./types.js";
import { REMOTE_SCOPES, TOOL_CAPABILITY_MAP } from "./types.js";
import { formDecode, jsonResponse } from "./util.js";
import { acceptWebSocketUpgrade, MinimalWebSocketConnection } from "./websocket.js";
import { SERVER_VERSION } from "../mcp.js";

const AGENT_NONCE_TTL_MS = 300_000;
const MAX_AGENT_CONNECTION_NONCES = 4096;

interface PendingAuthorize {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state: string;
  expiresAt: number;
}

interface AgentConnection {
  agent: RemoteAgentRecord;
  connection: MinimalWebSocketConnection;
  seenNonces: Map<string, number>;
}

interface PendingAction {
  action: ActionRecord;
  resolve: (value: ActionResultEnvelope) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function negotiateMcpProtocolVersion(params: unknown): string {
  const requestedVersion = isRecord(params) ? asString(params.protocolVersion) : undefined;
  return requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : LATEST_PROTOCOL_VERSION;
}

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function pruneNonceWindow(nonces: Map<string, number>, now = Date.now()): void {
  for (const [nonce, expiresAt] of nonces.entries()) {
    if (expiresAt <= now) {
      nonces.delete(nonce);
    }
  }
}

function hasSeenNonce(nonces: Map<string, number>, nonce: string, now = Date.now()): boolean {
  pruneNonceWindow(nonces, now);
  return nonces.has(nonce);
}

function rememberNonce(nonces: Map<string, number>, nonce: string, now = Date.now()): void {
  pruneNonceWindow(nonces, now);
  nonces.set(nonce, now + AGENT_NONCE_TTL_MS);
  while (nonces.size > MAX_AGENT_CONNECTION_NONCES) {
    const oldest = nonces.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    nonces.delete(oldest);
  }
}

function addNoStore(headers: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    ...headers,
  };
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function safeError(
  code: RemoteErrorCode,
  message: string,
  status = 400,
): { code: RemoteErrorCode; message: string; status: number } {
  return { code, message, status };
}

function isValidEd25519PublicKey(publicKeyPem: string): boolean {
  try {
    return createPublicKey(publicKeyPem).asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw safeError("FORBIDDEN", "Request body is too large", 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw safeError("INTERNAL_ERROR", "Expected JSON object");
  }
  return parsed;
}

async function readJsonOrForm(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(req);
  const contentType = req.headers["content-type"] ?? "";
  if (String(contentType).includes("application/json")) {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!isRecord(parsed)) {
      throw safeError("INTERNAL_ERROR", "Expected JSON object");
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        typeof value === "string" ? value : String(value ?? ""),
      ]),
    );
  }
  try {
    return formDecode(raw);
  } catch {
    throw safeError("INVALID_CLIENT", "Duplicate form parameter");
  }
}

function isSafeRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") {
      return true;
    }
    return (
      parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

function scopeList(scope: string): RemoteScope[] {
  const valid = new Set<string>(REMOTE_SCOPES);
  const rawScopes = scope.split(/\s+/u).filter(Boolean);
  if (rawScopes.some((entry) => !valid.has(entry))) {
    throw safeError("INVALID_SCOPE", "Requested scope is not supported");
  }
  const scopes = parseScopes(scope);
  return scopes.length > 0 ? scopes : ["hosts:read", "agents:read", "status:read", "logs:read"];
}

function sanitizeAgent(agent: RemoteAgentRecord): Record<string, unknown> {
  return {
    id: agent.id,
    alias: agent.alias,
    status: agent.status,
    profile: agent.profile,
    policy_version: agent.policyVersion,
    host_metadata: agent.hostMetadata,
    last_seen_at: agent.lastSeenAt,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
  };
}

export class RemoteControlPlane {
  readonly config: RemoteConfig;
  readonly store: RemoteStore;
  private readonly authorizeTransactions = new Map<string, PendingAuthorize>();
  private readonly agentConnections = new Map<string, AgentConnection>();
  private readonly agentHelloNonces = new Map<string, Map<string, number>>();
  private readonly pendingActions = new Map<string, PendingAction>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private jwtKeyPair: JwtKeyPair | undefined;
  private readonly controlPlaneKeyPair: PemKeyPair;

  constructor(config = loadRemoteConfig()) {
    this.config = config;
    this.store = new RemoteStore(config.databaseUrl);
    this.controlPlaneKeyPair = ensurePemKeyPair(config.controlPlaneSigningKeyPath);
    this.cleanupInterval = setInterval(() => this.cleanupEphemeralState(), 60_000);
    this.cleanupInterval.unref?.();
  }

  async initialize(): Promise<void> {
    this.jwtKeyPair = await loadJwtKeyPair(this.config.jwtSigningKeyPath);
  }

  close(): void {
    clearInterval(this.cleanupInterval);
    for (const pending of this.pendingActions.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Control plane shutting down"));
    }
    this.pendingActions.clear();
    for (const entry of this.agentConnections.values()) {
      entry.connection.close();
    }
    this.agentConnections.clear();
    this.agentHelloNonces.clear();
    this.authorizeTransactions.clear();
    this.store.close();
  }

  private cleanupEphemeralState(now = Date.now()): void {
    for (const [transactionId, transaction] of this.authorizeTransactions.entries()) {
      if (transaction.expiresAt <= now) {
        this.authorizeTransactions.delete(transactionId);
      }
    }
    for (const [agentId, nonces] of this.agentHelloNonces.entries()) {
      pruneNonceWindow(nonces, now);
      if (nonces.size === 0) {
        this.agentHelloNonces.delete(agentId);
      }
    }
    for (const live of this.agentConnections.values()) {
      pruneNonceWindow(live.seenNonces, now);
    }
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
      jsonResponse(res, 200, this.protectedResourceMetadata(), addNoStore());
      return true;
    }
    if (pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      jsonResponse(res, 200, this.authorizationServerMetadata(), addNoStore());
      return true;
    }
    if (pathname === "/oauth/register" && req.method === "POST") {
      await this.handleRegister(req, res);
      return true;
    }
    if (pathname === "/oauth/authorize" && req.method === "GET") {
      await this.handleAuthorize(req, res);
      return true;
    }
    if (pathname === "/oauth/callback/github" && req.method === "GET") {
      await this.handleGitHubCallback(req, res);
      return true;
    }
    if (pathname === "/oauth/token" && req.method === "POST") {
      await this.handleToken(req, res);
      return true;
    }
    if (pathname === "/oauth/jwks.json" && req.method === "GET") {
      await this.handleJwks(res);
      return true;
    }
    if (pathname === "/readyz" && req.method === "GET") {
      jsonResponse(res, 200, {
        ok: true,
        service: "ssh-mcp-pro",
        control_plane: true,
        agents_online: this.agentConnections.size,
      });
      return true;
    }
    if (pathname === "/mcp") {
      await this.handleMcp(req, res);
      return true;
    }
    if (pathname.startsWith("/api/agents") || pathname === "/api/audit") {
      await this.handleApi(req, res, pathname);
      return true;
    }
    return false;
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer<ArrayBufferLike>,
    pathname: string,
  ): boolean {
    if (pathname !== this.config.agentWsPath) {
      return false;
    }
    const connection = acceptWebSocketUpgrade(req, socket, head);
    connection.onText((message) => {
      void this.handleAgentMessage(connection, message).catch(() => {
        connection.sendJson({
          type: "error",
          code: "INTERNAL_ERROR",
          message: "Agent message failed",
        });
        connection.close();
      });
    });
    return true;
  }

  private protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.config.mcpResourceUrl,
      resource_name: "SshAutomator MCP",
      authorization_servers: [this.config.publicBaseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: REMOTE_SCOPES,
    };
  }

  private authorizationServerMetadata(): Record<string, unknown> {
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

  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const redirectUris = asStringArray(body.redirect_uris);
    if (redirectUris.length === 0 || redirectUris.some((uri) => !isSafeRedirectUri(uri))) {
      throw safeError(
        "INVALID_REDIRECT_URI",
        "redirect_uris must contain HTTPS URLs or localhost HTTP URLs",
      );
    }
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

  private async handleAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const client = this.store.getClient(clientId);
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

  private async handleGitHubCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/oauth/callback/github", this.config.publicBaseUrl);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const pending = this.authorizeTransactions.get(state);
    this.authorizeTransactions.delete(state);
    if (!code || !pending || pending.expiresAt < Date.now()) {
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

  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const jwtKeyPair = this.requireJwtKeyPair();
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

  private async handleJwks(res: ServerResponse): Promise<void> {
    const jwtKeyPair = this.requireJwtKeyPair();
    jsonResponse(
      res,
      200,
      { keys: [await publicJwkFromPem(jwtKeyPair.publicKeyPem)] },
      addNoStore(),
    );
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      this.sendUnauthorized(res);
      return;
    }
    let principal: RemotePrincipal;
    try {
      principal = await this.authenticate(req);
    } catch {
      this.sendUnauthorized(res);
      return;
    }
    const body = await readJson(req);
    const method = asString(body.method) ?? "";
    const rpcId = body.id ?? null;
    if (method === "initialize") {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          protocolVersion: negotiateMcpProtocolVersion(body.params),
          capabilities: { tools: {} },
          serverInfo: { name: "sshautomator-remote-agent", version: SERVER_VERSION },
        },
      });
      return;
    }
    if (method === "tools/list") {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: { tools: listRemoteToolDescriptors(principal.capabilities) },
      });
      return;
    }
    if (method === "tools/call") {
      const params = isRecord(body.params) ? body.params : {};
      const name = asString(params.name) as RemoteToolName | undefined;
      const args = isRecord(params.arguments) ? params.arguments : {};
      if (!name || !(name in TOOL_CAPABILITY_MAP)) {
        jsonResponse(res, 200, {
          jsonrpc: "2.0",
          id: rpcId,
          error: { code: -32602, message: "Unknown tool" },
        });
        return;
      }
      const result = await this.callRemoteTool(principal, name, args);
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      });
      return;
    }
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id: rpcId,
      error: { code: -32601, message: "Method not found" },
    });
  }

  private async handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (pathname === "/api/agents/enroll" && req.method === "POST") {
      await this.handleAgentEnroll(req, res);
      return;
    }

    const principal = await this.authenticate(req);
    if (pathname === "/api/agents/enrollment-tokens" && req.method === "POST") {
      const body = await readJson(req);
      const result = this.createEnrollmentToken(principal, body);
      jsonResponse(res, 201, result, addNoStore());
      return;
    }
    if (pathname === "/api/agents" && req.method === "GET") {
      jsonResponse(res, 200, {
        agents: this.store.listAgents(principal.userId).map(sanitizeAgent),
      });
      return;
    }
    const agentMatch = /^\/api\/agents\/([^/]+)(?:\/(policy|revoke))?$/u.exec(pathname);
    if (agentMatch) {
      const agent = this.resolveAgent(principal.userId, agentMatch[1] ?? "");
      if (!agent) {
        throw safeError("AGENT_NOT_FOUND", "Agent not found", 404);
      }
      if (!agentMatch[2] && req.method === "GET") {
        jsonResponse(res, 200, { agent: sanitizeAgent(agent) });
        return;
      }
      if ((!agentMatch[2] || agentMatch[2] === "policy") && req.method === "PATCH") {
        const body = await readJson(req);
        jsonResponse(res, 200, {
          agent: sanitizeAgent(this.updateAgentPolicy(principal, agent, body.policy)),
        });
        return;
      }
      if (agentMatch[2] === "revoke" && req.method === "POST") {
        jsonResponse(res, 200, { agent: sanitizeAgent(this.revokeAgent(principal, agent)) });
        return;
      }
    }
    if (pathname === "/api/audit" && req.method === "GET") {
      const url = new URL(req.url ?? "/api/audit", this.config.publicBaseUrl);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      jsonResponse(res, 200, { events: this.store.listAudit(principal.userId, undefined, limit) });
      return;
    }
    jsonResponse(res, 404, { error: "Not found" });
  }

  private async handleAgentEnroll(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const token = asString(body.token) ?? "";
    const publicKey = asString(body.public_key) ?? "";
    const host = isRecord(body.host) ? parseAgentHostMetadata(body.host) : undefined;
    if (!token || !publicKey || !host) {
      throw safeError("FORBIDDEN", "token, public_key, and host are required");
    }
    if (!isValidEd25519PublicKey(publicKey)) {
      throw safeError("FORBIDDEN", "public_key must be an Ed25519 SPKI PEM public key");
    }
    const enrollment = this.store.getEnrollmentTokenByHash(hashSecret(token));
    if (!enrollment || enrollment.usedAt || new Date(enrollment.expiresAt).getTime() < Date.now()) {
      throw safeError("INVALID_TOKEN", "Enrollment token is expired or invalid", 401);
    }
    const agent = this.store.getAgent(enrollment.agentId);
    if (!agent || agent.status === "revoked") {
      throw safeError("AGENT_NOT_FOUND", "Pending agent not found", 404);
    }
    const now = nowIso();
    try {
      this.store.markEnrollmentTokenUsed(enrollment.tokenHash, now);
    } catch {
      throw safeError("INVALID_TOKEN", "Enrollment token is expired or invalid", 401);
    }
    const updated: RemoteAgentRecord = {
      ...agent,
      status: "offline",
      publicKey,
      hostMetadata: host,
      updatedAt: now,
    };
    this.store.updateAgent(updated);
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_enrolled",
      severity: "info",
      metadata: { alias: agent.alias, host: host.hostname },
    });
    jsonResponse(
      res,
      200,
      {
        agent_id: agent.id,
        alias: agent.alias,
        policy: agent.policy,
        websocket_url: `${this.config.publicBaseUrl.replace(/^http/u, "ws")}${this.config.agentWsPath}`,
        control_plane_public_key: this.controlPlaneKeyPair.publicKeyPem,
      },
      addNoStore(),
    );
  }

  private async handleAgentMessage(
    connection: MinimalWebSocketConnection,
    message: string,
  ): Promise<void> {
    const payload = JSON.parse(message) as unknown;
    if (!isRecord(payload)) {
      connection.sendJson({ type: "error", code: "INTERNAL_ERROR", message: "Invalid message" });
      connection.close();
      return;
    }
    if (payload.type === "agent.hello") {
      await this.handleAgentHello(connection, parseAgentHelloEnvelope(payload));
      return;
    }
    if (payload.type === "action.result") {
      await this.handleActionResult(connection, parseActionResultEnvelope(payload));
      return;
    }
    connection.sendJson({ type: "error", code: "INTERNAL_ERROR", message: "Unknown message type" });
    connection.close();
  }

  private async handleAgentHello(
    connection: MinimalWebSocketConnection,
    hello: AgentHelloEnvelope,
  ): Promise<void> {
    const agent = this.store.getAgent(hello.agent_id);
    if (!agent || agent.status === "revoked" || !agent.publicKey) {
      connection.sendJson({
        type: "error",
        code: "AGENT_NOT_FOUND",
        message: "Agent is not enrolled",
      });
      connection.close();
      return;
    }
    if (!verifyEnvelope(hello as unknown as Record<string, unknown>, agent.publicKey)) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_signature_invalid",
        severity: "warn",
        metadata: { message_type: "agent.hello" },
      });
      connection.sendJson({
        type: "error",
        code: "SIGNATURE_INVALID",
        message: "Agent signature is invalid",
      });
      connection.close();
      return;
    }
    const timestampAgeMs = Math.abs(Date.now() - new Date(hello.timestamp).getTime());
    if (timestampAgeMs > 300_000) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_hello_expired",
        severity: "warn",
        metadata: {},
      });
      connection.sendJson({
        type: "error",
        code: "ACTION_EXPIRED",
        message: "Agent hello timestamp is stale",
      });
      connection.close();
      return;
    }
    const now = Date.now();
    this.cleanupEphemeralState(now);
    const existingConnection = this.agentConnections.get(agent.id);
    if (existingConnection?.connection === connection) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_duplicate_hello_rejected",
        severity: "warn",
        metadata: {},
      });
      connection.sendJson({
        type: "error",
        code: "ACTION_REPLAY_DETECTED",
        message: "Agent hello was already processed on this connection",
      });
      connection.close();
      return;
    }
    const helloNonces = this.agentHelloNonces.get(agent.id) ?? new Map<string, number>();
    if (helloNonces.has(hello.nonce)) {
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_hello_replay_detected",
        severity: "warn",
        metadata: {},
      });
      connection.sendJson({
        type: "error",
        code: "ACTION_REPLAY_DETECTED",
        message: "Agent hello nonce was already used",
      });
      connection.close();
      return;
    }
    helloNonces.set(hello.nonce, now + AGENT_NONCE_TTL_MS);
    this.agentHelloNonces.set(agent.id, helloNonces);
    if (existingConnection) {
      existingConnection.connection.close();
    }
    const seenNonces = new Map<string, number>();
    rememberNonce(seenNonces, hello.nonce, now);
    this.agentConnections.set(agent.id, { agent, connection, seenNonces });
    const online: RemoteAgentRecord = {
      ...agent,
      status: "online",
      lastSeenAt: nowIso(),
      hostMetadata: hello.host,
      updatedAt: nowIso(),
    };
    this.store.updateAgent(online);
    connection.onClose(() => {
      const live = this.agentConnections.get(agent.id);
      if (live?.connection !== connection) {
        return;
      }
      this.agentConnections.delete(agent.id);
      const latest = this.store.getAgent(agent.id);
      if (latest && latest.status !== "revoked") {
        this.store.updateAgent({ ...latest, status: "offline", updatedAt: nowIso() });
      }
      this.audit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent_disconnected",
        severity: "info",
        metadata: {},
      });
    });
    this.audit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent_connected",
      severity: "info",
      metadata: { agent_version: hello.agent_version, host: hello.host.hostname },
    });
    connection.sendJson({ type: "agent.ready", agent_id: agent.id, policy: agent.policy });
  }

  private async handleActionResult(
    connection: MinimalWebSocketConnection,
    result: ActionResultEnvelope,
  ): Promise<void> {
    const pending = this.pendingActions.get(result.action_id);
    if (!pending) {
      return;
    }
    const agent = this.store.getAgent(result.agent_id);
    if (
      !agent?.publicKey ||
      !verifyEnvelope(result as unknown as Record<string, unknown>, agent.publicKey)
    ) {
      clearTimeout(pending.timeout);
      this.pendingActions.delete(result.action_id);
      this.audit({
        userId: pending.action.userId,
        agentId: pending.action.agentId,
        actionId: pending.action.id,
        eventType: "agent_result_signature_invalid",
        severity: "warn",
        metadata: {},
      });
      pending.reject(new Error("Agent result signature is invalid"));
      return;
    }
    const live = this.agentConnections.get(result.agent_id);
    if (pending.action.agentId !== result.agent_id || live?.connection !== connection) {
      clearTimeout(pending.timeout);
      this.pendingActions.delete(result.action_id);
      this.audit({
        userId: pending.action.userId,
        agentId: pending.action.agentId,
        actionId: pending.action.id,
        eventType: "agent_result_connection_invalid",
        severity: "warn",
        metadata: {},
      });
      pending.reject(
        Object.assign(new Error("Agent result came from an unexpected connection"), {
          code: "SIGNATURE_INVALID" satisfies RemoteErrorCode,
        }),
      );
      return;
    }
    const now = Date.now();
    if (hasSeenNonce(live.seenNonces, result.nonce, now)) {
      clearTimeout(pending.timeout);
      this.pendingActions.delete(result.action_id);
      this.audit({
        userId: pending.action.userId,
        agentId: pending.action.agentId,
        actionId: pending.action.id,
        eventType: "agent_result_replay_detected",
        severity: "warn",
        metadata: {},
      });
      pending.reject(
        Object.assign(new Error("Agent result nonce was already used"), {
          code: "ACTION_REPLAY_DETECTED" satisfies RemoteErrorCode,
        }),
      );
      return;
    }
    rememberNonce(live.seenNonces, result.nonce, now);
    clearTimeout(pending.timeout);
    this.pendingActions.delete(result.action_id);
    pending.resolve(result);
  }

  private async authenticate(req: IncomingMessage): Promise<RemotePrincipal> {
    try {
      return await verifyRemoteAccessToken(
        req.headers.authorization,
        this.config,
        this.requireJwtKeyPair(),
      );
    } catch {
      this.audit({
        eventType: "token_validation_failure",
        severity: "warn",
        metadata: {},
      });
      throw safeError("UNAUTHORIZED", "Missing or invalid bearer token", 401);
    }
  }

  private sendUnauthorized(res: ServerResponse): void {
    jsonResponse(
      res,
      401,
      { error: "Missing or invalid bearer token" },
      {
        "WWW-Authenticate": `Bearer resource_metadata="${this.config.publicBaseUrl}/.well-known/oauth-protected-resource"`,
      },
    );
  }

  private async callRemoteTool(
    principal: RemotePrincipal,
    tool: RemoteToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const capability = TOOL_CAPABILITY_MAP[tool];
    if (!hasCapability(principal.capabilities, capability)) {
      throw safeError("INVALID_SCOPE", `Scope does not grant ${capability}`, 403);
    }

    if (tool === "list_hosts") {
      return {
        hosts: this.store.listAgents(principal.userId).map((agent) => ({
          id: agent.id,
          alias: agent.alias,
          status: agent.status,
          host: agent.hostMetadata,
        })),
      };
    }
    if (tool === "list_agents") {
      return { agents: this.store.listAgents(principal.userId).map(sanitizeAgent) };
    }
    if (tool === "create_enrollment_token") {
      return this.createEnrollmentToken(principal, args);
    }
    if (tool === "get_agent_install_command") {
      const agent = this.requireAgent(principal.userId, args);
      return this.installCommand(agent, undefined);
    }
    if (tool === "update_agent_policy") {
      const agent = this.requireAgent(principal.userId, args);
      return { agent: sanitizeAgent(this.updateAgentPolicy(principal, agent, args.policy)) };
    }
    if (tool === "revoke_agent") {
      const agent = this.requireAgent(principal.userId, args);
      return { agent: sanitizeAgent(this.revokeAgent(principal, agent)) };
    }
    if (tool === "get_audit_events") {
      const agentId = asString(args.agent_id_or_alias)
        ? this.resolveAgent(principal.userId, String(args.agent_id_or_alias))?.id
        : undefined;
      return { events: this.store.listAudit(principal.userId, agentId, Number(args.limit ?? 50)) };
    }

    const agent = this.requireAgent(principal.userId, args);
    if (!agent.policy.capabilities[capability]) {
      this.audit({
        userId: principal.userId,
        agentId: agent.id,
        eventType: "action_denied",
        severity: "warn",
        metadata: { tool, capability, reason: "capability disabled by agent policy" },
      });
      throw safeError("CAPABILITY_DENIED", `Agent policy does not allow ${capability}`, 403);
    }
    const actionResult = await this.dispatchAction(principal, agent, tool, capability, args);
    return { action: actionResult };
  }

  private createEnrollmentToken(
    principal: RemotePrincipal,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const alias = asString(args.alias)?.trim();
    if (!alias) {
      throw safeError("FORBIDDEN", "alias is required");
    }
    const profile = asString(args.requested_profile) ?? "read-only";
    const policy = createAgentPolicy(
      profile === "operations" || profile === "full-admin" ? profile : "read-only",
    );
    const now = nowIso();
    const existing = this.store.getAgentByAlias(principal.userId, alias);
    if (existing && existing.status !== "revoked") {
      throw safeError("FORBIDDEN", "Agent alias already exists");
    }
    const agent: RemoteAgentRecord = {
      id: id("agt"),
      userId: principal.userId,
      alias,
      status: "pending",
      profile: policy.profile,
      policy,
      policyVersion: policy.version,
      createdAt: now,
      updatedAt: now,
    };
    const token = randomToken(32);
    this.store.insertAgent(agent);
    this.store.insertEnrollmentToken({
      id: id("enr"),
      agentId: agent.id,
      userId: principal.userId,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + this.config.enrollmentTokenTtlSeconds * 1000).toISOString(),
      createdAt: now,
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "enrollment_token_created",
      severity: "info",
      metadata: { alias, profile: policy.profile },
    });
    return { ...this.installCommand(agent, token), enrollment_token: token };
  }

  private installCommand(
    agent: RemoteAgentRecord,
    token: string | undefined,
  ): Record<string, unknown> {
    const tokenArgument = token ?? "<create-a-new-enrollment-token>";
    const posixBase = [
      "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll",
      `--server ${quotePosixArg(this.config.publicBaseUrl)}`,
      `--token ${quotePosixArg(tokenArgument)}`,
      `--alias ${quotePosixArg(agent.alias)}`,
    ].join(" ");
    const powershellBase = [
      "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll",
      `--server ${quotePowerShellArg(this.config.publicBaseUrl)}`,
      `--token ${quotePowerShellArg(tokenArgument)}`,
      `--alias ${quotePowerShellArg(agent.alias)}`,
    ].join(" ");
    return {
      agent_id: agent.id,
      alias: agent.alias,
      token_recoverable: Boolean(token),
      commands: {
        npm: posixBase,
        run: "npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run",
        windows: powershellBase,
      },
      expires_in_seconds: token ? this.config.enrollmentTokenTtlSeconds : undefined,
    };
  }

  private updateAgentPolicy(
    principal: RemotePrincipal,
    agent: RemoteAgentRecord,
    value: unknown,
  ): RemoteAgentRecord {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const nextVersion = agent.policyVersion + 1;
    const merged = mergeCustomPolicy(isRecord(value) ? value : {});
    const policy = {
      ...merged,
      maxActionTimeoutSeconds: Math.min(
        merged.maxActionTimeoutSeconds,
        this.config.maxActionTimeoutSeconds,
      ),
      maxOutputBytes: Math.min(merged.maxOutputBytes, this.config.maxOutputBytes),
      version: nextVersion,
    };
    const updated = {
      ...agent,
      profile: policy.profile,
      policy,
      policyVersion: nextVersion,
      updatedAt: nowIso(),
    };
    this.store.updateAgent(updated);
    const live = this.agentConnections.get(agent.id);
    if (live) {
      const envelope: PolicyUpdateEnvelope = {
        type: "policy.update",
        agent_id: agent.id,
        policy,
        policy_version: nextVersion,
        issued_at: nowIso(),
        nonce: randomToken(16),
        signature: "",
      };
      envelope.signature = signEnvelope(
        envelope as unknown as Record<string, unknown>,
        this.controlPlaneKeyPair.privateKeyPem,
      );
      live.connection.sendJson(envelope);
    }
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "policy_updated",
      severity: "warn",
      metadata: { profile: updated.profile, policy_version: updated.policyVersion },
    });
    return updated;
  }

  private revokeAgent(principal: RemotePrincipal, agent: RemoteAgentRecord): RemoteAgentRecord {
    if (!hasCapability(principal.capabilities, "agents.admin")) {
      throw safeError("INVALID_SCOPE", "agents:admin scope is required", 403);
    }
    const updated = { ...agent, status: "revoked" as const, updatedAt: nowIso() };
    this.store.updateAgent(updated);
    this.agentConnections.get(agent.id)?.connection.close();
    this.agentConnections.delete(agent.id);
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      eventType: "agent_revoked",
      severity: "warn",
      metadata: {},
    });
    return updated;
  }

  private async dispatchAction(
    principal: RemotePrincipal,
    agent: RemoteAgentRecord,
    tool: RemoteToolName,
    capability: ActionRecord["capability"],
    args: Record<string, unknown>,
  ): Promise<ActionResultEnvelope> {
    if (agent.status === "revoked") {
      throw safeError("AGENT_REVOKED", "Agent is revoked", 410);
    }
    const live = this.agentConnections.get(agent.id);
    if (!live) {
      throw safeError("AGENT_OFFLINE", "Agent is offline", 503);
    }
    const actionId = id("act");
    const timeoutSeconds = Math.min(
      Number(args.timeout_seconds ?? agent.policy.maxActionTimeoutSeconds),
      agent.policy.maxActionTimeoutSeconds,
      this.config.maxActionTimeoutSeconds,
    );
    const issuedAt = nowIso();
    const deadline = new Date(Date.now() + timeoutSeconds * 1000).toISOString();
    const envelope: ActionRequestEnvelope = {
      type: "action.request",
      action_id: actionId,
      agent_id: agent.id,
      user_id: principal.userId,
      tool,
      capability,
      args,
      policy_version: agent.policyVersion,
      issued_at: issuedAt,
      deadline,
      nonce: randomToken(16),
      signature: "",
    };
    envelope.signature = signEnvelope(
      envelope as unknown as Record<string, unknown>,
      this.controlPlaneKeyPair.privateKeyPem,
    );
    const action: ActionRecord = {
      id: actionId,
      userId: principal.userId,
      agentId: agent.id,
      tool,
      capability,
      args,
      status: "sent",
      issuedAt,
      deadline,
    };
    this.store.insertAction(action);
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      actionId,
      eventType: "action_requested",
      severity: "info",
      metadata: { tool, capability },
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      actionId,
      eventType: "action_allowed",
      severity: "info",
      metadata: { tool, capability },
    });
    let result: ActionResultEnvelope;
    try {
      result = await new Promise<ActionResultEnvelope>((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            this.pendingActions.delete(actionId);
            reject(Object.assign(new Error("Agent timed out"), { code: "AGENT_TIMEOUT" }));
          },
          timeoutSeconds * 1000 + 2000,
        );
        this.pendingActions.set(actionId, { action, resolve, reject, timeout });
        live.connection.sendJson(envelope);
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: RemoteErrorCode }).code
          : "INTERNAL_ERROR";
      this.store.updateAction({
        ...action,
        status: code === "AGENT_TIMEOUT" ? "timeout" : "error",
        completedAt: nowIso(),
        errorCode: code,
      });
      this.audit({
        userId: principal.userId,
        agentId: agent.id,
        actionId,
        eventType: "action_denied_or_failed",
        severity: "warn",
        metadata: { status: "error", error_code: code },
      });
      throw safeError(
        code,
        code === "AGENT_TIMEOUT" ? "Agent timed out" : "Agent action failed",
        504,
      );
    }
    this.store.updateAction({
      ...action,
      status: result.status === "ok" ? "completed" : "error",
      completedAt: nowIso(),
      result,
      errorCode: result.error_code,
    });
    this.audit({
      userId: principal.userId,
      agentId: agent.id,
      actionId,
      eventType: result.status === "ok" ? "action_completed" : "action_denied_or_failed",
      severity: result.status === "ok" ? "info" : "warn",
      metadata: { status: result.status, error_code: result.error_code },
    });
    return result;
  }

  private requireAgent(userId: string, args: Record<string, unknown>): RemoteAgentRecord {
    const agent = this.resolveAgent(userId, asString(args.agent_id_or_alias) ?? "");
    if (!agent) {
      throw safeError("AGENT_NOT_FOUND", "Agent not found", 404);
    }
    return agent;
  }

  private resolveAgent(userId: string, value: string): RemoteAgentRecord | undefined {
    if (!value) {
      return undefined;
    }
    const byId = this.store.getAgent(value);
    if (byId?.userId === userId) {
      return byId;
    }
    return this.store.getAgentByAlias(userId, value);
  }

  private audit(input: Omit<AuditEvent, "id" | "createdAt">): void {
    this.store.insertAudit({
      id: id("aud"),
      createdAt: nowIso(),
      ...input,
      metadata: input.metadata,
    });
  }

  private requireJwtKeyPair(): JwtKeyPair {
    if (!this.jwtKeyPair) {
      throw new Error("Remote control plane was not initialized");
    }
    return this.jwtKeyPair;
  }
}

export async function createRemoteControlPlane(): Promise<RemoteControlPlane> {
  const controlPlane = new RemoteControlPlane();
  await controlPlane.initialize();
  return controlPlane;
}

export function controlPlanePublicKeyId(controlPlaneKeyPair: PemKeyPair): string {
  return keyId(controlPlaneKeyPair.publicKeyPem);
}
