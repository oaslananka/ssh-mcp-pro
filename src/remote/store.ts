import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { migrateRemoteStoreSchema } from "./store-schema.js";
import type {
  ActionRecord,
  AgentEnrollmentTokenRecord,
  AuditEvent,
  GitHubUser,
  GoogleUser,
  OAuthAuthorizationCode,
  OAuthRefreshTokenRecord,
  OAuthClient,
  RemoteAgentRecord,
} from "./types.js";

type SqlValue = string | number | null;
type DatabaseSyncConstructor = typeof import("node:sqlite").DatabaseSync;
type NodeSqliteModule = { DatabaseSync: unknown };

type RemoteStoreOptions = {
  loadSqlite?: () => NodeSqliteModule;
};

const require = createRequire(import.meta.url);

function loadNodeSqlite(): NodeSqliteModule {
  return require("node:sqlite") as NodeSqliteModule;
}

function resolveDatabaseSync(
  loadSqlite: () => NodeSqliteModule = loadNodeSqlite,
): DatabaseSyncConstructor {
  try {
    const { DatabaseSync } = loadSqlite();
    if (typeof DatabaseSync !== "function") {
      throw new TypeError("DatabaseSync is not a constructor");
    }
    return DatabaseSync as DatabaseSyncConstructor;
  } catch (error) {
    throw new Error(
      `node:sqlite is not available in this Node.js build (${process.version}). ` +
        "This feature requires Node.js >=22.13.0. " +
        "See ARCHITECTURE.md for the better-sqlite3 fallback path.",
      { cause: error },
    );
  }
}

function dbPathFromUrl(databaseUrl: string): string {
  if (databaseUrl === ":memory:" || databaseUrl === "file::memory:") {
    return ":memory:";
  }
  if (databaseUrl.startsWith("file:")) {
    return databaseUrl.slice("file:".length);
  }
  return databaseUrl;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  throw new TypeError("Unexpected database column type");
}

function optionalRowString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenUseConflict(message: string): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code: "INVALID_TOKEN", status: 400 });
}

export class RemoteStore {
  private readonly db: InstanceType<DatabaseSyncConstructor>;

  constructor(databaseUrl: string, options: RemoteStoreOptions = {}) {
    const filePath = dbPathFromUrl(databaseUrl);
    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    }
    const DatabaseSync = resolveDatabaseSync(options.loadSqlite);
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    migrateRemoteStoreSchema(this.db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Reclaim only records whose time-limited credentials have expired.
   * Device, account, action and security audit history is intentionally
   * outside this cleanup policy.
   */
  pruneExpiredTransientRecords(now: string): void {
    this.db.prepare("DELETE FROM dashboard_sessions WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM oauth_authorization_codes WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM agent_enrollment_tokens WHERE expires_at <= ?").run(now);
  }

  createDashboardSession(
    tokenHash: string,
    userId: string,
    expiresAt: string,
    createdAt: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO dashboard_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(tokenHash, userId, expiresAt, createdAt);
  }

  getDashboardSession(tokenHash: string, now: string): { userId: string } | undefined {
    const row = this.db
      .prepare("SELECT user_id FROM dashboard_sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash, now) as Record<string, unknown> | undefined;
    return row ? { userId: rowString(row, "user_id") } : undefined;
  }

  deleteDashboardSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM dashboard_sessions WHERE token_hash = ?").run(tokenHash);
  }

  upsertUser(user: GitHubUser & { internalId: string; now: string }): void {
    this.db
      .prepare(
        `INSERT INTO users (id, github_id, github_login, display_name, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'github', ?, ?)
         ON CONFLICT(id) DO UPDATE SET github_id = excluded.github_id, github_login = excluded.github_login, display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .run(user.internalId, user.id, user.login, user.login, user.now, user.now);
  }

  upsertGoogleUser(user: GoogleUser & { internalId: string; now: string }): void {
    this.db
      .prepare(
        `INSERT INTO users (id, google_id, email, display_name, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'google', ?, ?)
         ON CONFLICT(id) DO UPDATE SET google_id = excluded.google_id, email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .run(user.internalId, user.id, user.email, user.name, user.now, user.now);
  }

  getUserByGitHubId(githubId: string):
    | {
        id: string;
        githubId: string;
        githubLogin: string;
        email?: string | undefined;
        displayName?: string | undefined;
      }
    | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE github_id = ?").get(githubId) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      githubId: rowString(row, "github_id"),
      githubLogin: rowString(row, "github_login"),
      email: optionalRowString(row, "email"),
      displayName: optionalRowString(row, "display_name") ?? rowString(row, "github_login"),
    };
  }

  getUserByGoogleId(
    googleId: string,
  ): { id: string; googleId: string; email?: string | undefined; displayName: string } | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      googleId: rowString(row, "google_id"),
      email: optionalRowString(row, "email"),
      displayName: rowString(row, "display_name"),
    };
  }

  getUserById(id: string):
    | {
        id: string;
        githubId?: string | undefined;
        githubLogin?: string | undefined;
        googleId?: string | undefined;
        email?: string | undefined;
        displayName: string;
        provider: "github" | "google";
      }
    | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      githubId: optionalRowString(row, "github_id"),
      githubLogin: optionalRowString(row, "github_login"),
      googleId: optionalRowString(row, "google_id"),
      email: optionalRowString(row, "email"),
      displayName:
        optionalRowString(row, "display_name") ??
        optionalRowString(row, "github_login") ??
        optionalRowString(row, "email") ??
        "User",
      provider: optionalRowString(row, "provider") === "google" ? "google" : "github",
    };
  }

  insertClient(client: OAuthClient): void {
    this.db
      .prepare(
        `INSERT INTO oauth_clients
         (id, client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        client.id,
        client.clientId,
        client.clientName,
        JSON.stringify(client.redirectUris),
        JSON.stringify(client.grantTypes),
        JSON.stringify(client.responseTypes),
        client.tokenEndpointAuthMethod,
        client.createdAt,
      );
  }

  getClient(clientId: string): OAuthClient | undefined {
    const row = this.db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      clientId: rowString(row, "client_id"),
      clientName: rowString(row, "client_name"),
      redirectUris: parseJson<string[]>(rowString(row, "redirect_uris")),
      grantTypes: parseJson<string[]>(rowString(row, "grant_types")),
      responseTypes: parseJson<string[]>(rowString(row, "response_types")),
      tokenEndpointAuthMethod: "none",
      createdAt: rowString(row, "created_at"),
    };
  }

  updateClientRedirectUris(clientId: string, redirectUris: string[]): void {
    this.db
      .prepare("UPDATE oauth_clients SET redirect_uris = ? WHERE client_id = ?")
      .run(JSON.stringify(redirectUris), clientId);
  }

  countOAuthClients(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM oauth_clients").get() as
      Record<string, unknown> | undefined;
    return Number(row?.count ?? 0);
  }

  createRefreshToken(token: OAuthRefreshTokenRecord): void {
    this.db
      .prepare(
        "INSERT INTO oauth_refresh_tokens " +
          "(token_hash, family_id, client_id, user_id, resource, scope, expires_at, used_at, revoked_at, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
      )
      .run(
        token.tokenHash,
        token.familyId,
        token.clientId,
        token.userId,
        token.resource,
        token.scope,
        token.expiresAt,
        token.createdAt,
      );
  }

  getRefreshTokenByHash(tokenHash: string): OAuthRefreshTokenRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?")
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      tokenHash: rowString(row, "token_hash"),
      familyId: rowString(row, "family_id"),
      clientId: rowString(row, "client_id"),
      userId: rowString(row, "user_id"),
      resource: rowString(row, "resource"),
      scope: rowString(row, "scope"),
      expiresAt: rowString(row, "expires_at"),
      usedAt: optionalRowString(row, "used_at"),
      revokedAt: optionalRowString(row, "revoked_at"),
      createdAt: rowString(row, "created_at"),
    };
  }

  /** Atomically consume and rotate. Replaying a consumed token revokes the family. */
  rotateRefreshToken(
    oldHash: string,
    clientId: string,
    successor: OAuthRefreshTokenRecord,
    now: string,
  ): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.getRefreshTokenByHash(oldHash);
      if (!previous) {
        this.db.exec("COMMIT");
        return false;
      }
      if (
        previous.clientId !== clientId ||
        previous.resource !== successor.resource ||
        previous.scope !== successor.scope ||
        previous.userId !== successor.userId ||
        previous.familyId !== successor.familyId ||
        previous.revokedAt ||
        previous.expiresAt <= now
      ) {
        this.db.exec("COMMIT");
        return false;
      }
      if (previous.usedAt) {
        this.db
          .prepare(
            "UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
          )
          .run(now, previous.familyId);
        this.db.exec("COMMIT");
        return false;
      }
      const result = this.db
        .prepare(
          "UPDATE oauth_refresh_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL",
        )
        .run(now, oldHash);
      if (Number(result.changes) !== 1) {
        throw tokenUseConflict("Refresh token already consumed");
      }
      this.createRefreshToken(successor);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Revoke all descendants of a credential without leaking whether it was valid. */
  revokeRefreshFamily(tokenHash: string, clientId: string, now: string): void {
    const token = this.getRefreshTokenByHash(tokenHash);
    if (!token) return;
    if (token.clientId !== clientId) return;
    this.db
      .prepare(
        "UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
      )
      .run(now, token.familyId);
  }

  insertAuthorizationCode(code: OAuthAuthorizationCode): void {
    this.db
      .prepare(
        `INSERT INTO oauth_authorization_codes
         (id, code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code.id,
        code.codeHash,
        code.clientId,
        code.userId,
        code.redirectUri,
        code.codeChallenge,
        code.codeChallengeMethod,
        code.resource,
        code.scope,
        code.expiresAt,
        code.usedAt ?? null,
        code.createdAt,
      );
  }

  getAuthorizationCodeByHash(codeHash: string): OAuthAuthorizationCode | undefined {
    const row = this.db
      .prepare("SELECT * FROM oauth_authorization_codes WHERE code_hash = ?")
      .get(codeHash) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      codeHash: rowString(row, "code_hash"),
      clientId: rowString(row, "client_id"),
      userId: rowString(row, "user_id"),
      redirectUri: rowString(row, "redirect_uri"),
      codeChallenge: rowString(row, "code_challenge"),
      codeChallengeMethod: "S256",
      resource: rowString(row, "resource"),
      scope: rowString(row, "scope"),
      expiresAt: rowString(row, "expires_at"),
      usedAt: optionalRowString(row, "used_at"),
      createdAt: rowString(row, "created_at"),
    };
  }

  markAuthorizationCodeUsed(codeHash: string, usedAt: string): void {
    const result = this.db
      .prepare(
        "UPDATE oauth_authorization_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL",
      )
      .run(usedAt, codeHash);
    if (Number(result.changes) !== 1) {
      throw tokenUseConflict("Authorization code already used");
    }
  }

  insertAgent(agent: RemoteAgentRecord): void {
    this.db
      .prepare(
        `INSERT INTO agents
         (id, user_id, alias, status, public_key, profile, policy_json, policy_version, host_metadata_json, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        agent.userId,
        agent.alias,
        agent.status,
        agent.publicKey ?? null,
        agent.profile,
        JSON.stringify(agent.policy),
        agent.policyVersion,
        agent.hostMetadata ? JSON.stringify(agent.hostMetadata) : null,
        agent.lastSeenAt ?? null,
        agent.createdAt,
        agent.updatedAt,
      );
  }

  updateAgent(agent: RemoteAgentRecord): void {
    this.db
      .prepare(
        `UPDATE agents
         SET alias = ?, status = ?, public_key = ?, profile = ?, policy_json = ?, policy_version = ?,
             host_metadata_json = ?, last_seen_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        agent.alias,
        agent.status,
        agent.publicKey ?? null,
        agent.profile,
        JSON.stringify(agent.policy),
        agent.policyVersion,
        agent.hostMetadata ? JSON.stringify(agent.hostMetadata) : null,
        agent.lastSeenAt ?? null,
        agent.updatedAt,
        agent.id,
      );
  }

  getAgent(agentId: string): RemoteAgentRecord | undefined {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as
      Record<string, unknown> | undefined;
    return row ? this.agentFromRow(row) : undefined;
  }

  /**
   * Discard a revoked device and enrollment/action data, while preserving
   * independent audit events for security review.
   */
  removeRevokedAgent(userId: string, agentId: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const removed = this.db
        .prepare("DELETE FROM agents WHERE id = ? AND user_id = ? AND status = 'revoked'")
        .run(agentId, userId);
      if (Number(removed.changes) !== 1) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db
        .prepare("DELETE FROM agent_enrollment_tokens WHERE user_id = ? AND agent_id = ?")
        .run(userId, agentId);
      this.db
        .prepare("DELETE FROM actions WHERE user_id = ? AND agent_id = ?")
        .run(userId, agentId);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getAgentByAlias(userId: string, alias: string): RemoteAgentRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM agents WHERE user_id = ? AND alias = ?")
      .get(userId, alias) as Record<string, unknown> | undefined;
    return row ? this.agentFromRow(row) : undefined;
  }

  listAgents(userId: string): RemoteAgentRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM agents WHERE user_id = ? ORDER BY created_at")
        .all(userId) as Record<string, unknown>[]
    ).map((row) => this.agentFromRow(row));
  }

  private agentFromRow(row: Record<string, unknown>): RemoteAgentRecord {
    return {
      id: rowString(row, "id"),
      userId: rowString(row, "user_id"),
      alias: rowString(row, "alias"),
      status: rowString(row, "status") as RemoteAgentRecord["status"],
      publicKey: optionalRowString(row, "public_key"),
      profile: rowString(row, "profile") as RemoteAgentRecord["profile"],
      policy: parseJson(rowString(row, "policy_json")),
      policyVersion: Number(row["policy_version"] ?? 1),
      hostMetadata: optionalRowString(row, "host_metadata_json")
        ? parseJson(optionalRowString(row, "host_metadata_json") ?? "{}")
        : undefined,
      lastSeenAt: optionalRowString(row, "last_seen_at"),
      createdAt: rowString(row, "created_at"),
      updatedAt: rowString(row, "updated_at"),
    };
  }

  insertEnrollmentToken(token: AgentEnrollmentTokenRecord): void {
    this.db
      .prepare(
        `INSERT INTO agent_enrollment_tokens
         (id, agent_id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token.id,
        token.agentId,
        token.userId,
        token.tokenHash,
        token.expiresAt,
        token.usedAt ?? null,
        token.createdAt,
      );
  }

  getEnrollmentTokenByHash(tokenHash: string): AgentEnrollmentTokenRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM agent_enrollment_tokens WHERE token_hash = ?")
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      agentId: rowString(row, "agent_id"),
      userId: rowString(row, "user_id"),
      tokenHash: rowString(row, "token_hash"),
      expiresAt: rowString(row, "expires_at"),
      usedAt: optionalRowString(row, "used_at"),
      createdAt: rowString(row, "created_at"),
    };
  }

  markEnrollmentTokenUsed(tokenHash: string, usedAt: string): void {
    const result = this.db
      .prepare(
        "UPDATE agent_enrollment_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
      )
      .run(usedAt, tokenHash);
    if (Number(result.changes) !== 1) {
      throw tokenUseConflict("Enrollment token already used");
    }
  }

  insertAction(action: ActionRecord): void {
    this.db
      .prepare(
        `INSERT INTO actions
         (id, user_id, agent_id, tool, capability, args_json, status, issued_at, deadline, completed_at, result_json, error_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.userId,
        action.agentId,
        action.tool,
        action.capability,
        JSON.stringify(action.args),
        action.status,
        action.issuedAt,
        action.deadline,
        action.completedAt ?? null,
        action.result ? JSON.stringify(action.result) : null,
        action.errorCode ?? null,
      );
  }

  updateAction(action: ActionRecord): void {
    this.db
      .prepare(
        `UPDATE actions
         SET status = ?, completed_at = ?, result_json = ?, error_code = ?
         WHERE id = ?`,
      )
      .run(
        action.status,
        action.completedAt ?? null,
        action.result ? JSON.stringify(action.result) : null,
        action.errorCode ?? null,
        action.id,
      );
  }

  insertAudit(event: AuditEvent): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (id, user_id, agent_id, action_id, event_type, severity, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.userId ?? null,
        event.agentId ?? null,
        event.actionId ?? null,
        event.eventType,
        event.severity,
        JSON.stringify(event.metadata),
        event.createdAt,
      );
  }

  listAudit(userId: string, agentId: string | undefined, limit: number): AuditEvent[] {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = agentId
      ? (this.db
          .prepare(
            "SELECT * FROM audit_events WHERE user_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?",
          )
          .all(userId, agentId, safeLimit) as Record<string, unknown>[])
      : (this.db
          .prepare("SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(userId, safeLimit) as Record<string, unknown>[]);
    return rows.map((row) => ({
      id: rowString(row, "id"),
      userId: optionalRowString(row, "user_id"),
      agentId: optionalRowString(row, "agent_id"),
      actionId: optionalRowString(row, "action_id"),
      eventType: rowString(row, "event_type"),
      severity: rowString(row, "severity") as AuditEvent["severity"],
      metadata: parseJson(rowString(row, "metadata_json")),
      createdAt: rowString(row, "created_at"),
    }));
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.db.prepare(sql).run(...params);
  }
}
