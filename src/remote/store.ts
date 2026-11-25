import { createRequire } from "node:module";
import { migrateRemoteStoreSchema } from "./store-schema.js";
import { prepareRemoteStoreFile } from "./store-file-permissions.js";
import { RemoteAccountStore } from "./store-accounts.js";
import { RemoteOAuthStore } from "./store-oauth.js";
import { parseJson, rowString, optionalRowString, tokenUseConflict } from "./store-row-values.js";
import {
  type ActionRecord,
  type AgentEnrollmentTokenRecord,
  type AuditEvent,
  type GitHubUser,
  type GoogleUser,
  type OAuthAuthorizationCode,
  type OAuthRefreshTokenRecord,
  type OAuthClient,
  type RemoteAgentRecord,
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

export class RemoteStore {
  private readonly db: InstanceType<DatabaseSyncConstructor>;
  private readonly accounts: RemoteAccountStore;
  private readonly oauth: RemoteOAuthStore;

  constructor(databaseUrl: string, options: RemoteStoreOptions = {}) {
    const filePath = dbPathFromUrl(databaseUrl);
    const DatabaseSync = resolveDatabaseSync(options.loadSqlite);
    if (filePath !== ":memory:") prepareRemoteStoreFile(filePath);
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    migrateRemoteStoreSchema(this.db);
    this.accounts = new RemoteAccountStore(this.db);
    this.oauth = new RemoteOAuthStore(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** Read-only, bounded usage aggregates for explicitly configured service owners. */
  getServiceUsage(): {
    registeredUsers: number;
    registeredAgents: number;
    totalActions: number;
    actionsLast7Days: number;
    actionsLast30Days: number;
    completedActions: number;
    failedActions: number;
    accounts: Array<{
      provider: string;
      label: string;
      agents: number;
      actions: number;
      lastActionAt: string | null;
    }>;
  } {
    return this.accounts.getServiceUsage();
  }

  /** Bounded, per-user usage summary for dashboard usage reporting. */
  getUserUsage(userId: string): {
    callsThisMonth: number;
    limit: number;
    dailyAverage: number;
    daysElapsed: number;
    daysRemaining: number;
    percentUsed: number;
    resetDate: string;
    callsOverTime: Array<{ month: string; count: number }>;
  } {
    return this.accounts.getUserUsage(userId);
  }

  /**
   * Reclaim expired credentials and unclaimed device placeholders. Real
   * devices, accounts, actions and security audit history are preserved.
   */
  pruneExpiredTransientRecords(now: string): void {
    // Remove only placeholders that have never enrolled and have no usable
    // token. Do this before pruning expired tokens, preserving their expiry
    // distinction and making an abandoned alias available for retry.
    this.db
      .prepare(
        `DELETE FROM agents
         WHERE status = 'pending'
           AND public_key IS NULL AND last_seen_at IS NULL
           AND created_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM agent_enrollment_tokens AS t
             WHERE t.agent_id = agents.id AND t.expires_at > ?
           )`,
      )
      .run(now, now);
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
    this.accounts.createDashboardSession(tokenHash, userId, expiresAt, createdAt);
  }

  getDashboardSession(tokenHash: string, now: string): { userId: string } | undefined {
    return this.accounts.getDashboardSession(tokenHash, now);
  }

  deleteDashboardSession(tokenHash: string): void {
    this.accounts.deleteDashboardSession(tokenHash);
  }

  upsertUser(user: GitHubUser & { internalId: string; now: string }): void {
    this.accounts.upsertUser(user);
  }

  upsertReviewerUser(now: string): void {
    this.accounts.upsertReviewerUser(now);
  }

  upsertGoogleUser(user: GoogleUser & { internalId: string; now: string }): void {
    this.accounts.upsertGoogleUser(user);
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
    return this.accounts.getUserByGitHubId(githubId);
  }

  getUserByGoogleId(
    googleId: string,
  ): { id: string; googleId: string; email?: string | undefined; displayName: string } | undefined {
    return this.accounts.getUserByGoogleId(googleId);
  }

  getUserById(id: string):
    | {
        id: string;
        githubId?: string | undefined;
        githubLogin?: string | undefined;
        googleId?: string | undefined;
        email?: string | undefined;
        displayName: string;
        provider: "github" | "google" | "demo";
      }
    | undefined {
    return this.accounts.getUserById(id);
  }

  insertClient(client: OAuthClient): void {
    this.oauth.insertClient(client);
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.oauth.getClient(clientId);
  }

  updateClientRedirectUris(clientId: string, redirectUris: string[]): void {
    this.oauth.updateClientRedirectUris(clientId, redirectUris);
  }

  /** Authorization identity is connection-specific, not the shared OAuth registration. */
  createOAuthConnection(userId: string, clientId: string, now: string): string {
    return this.oauth.createOAuthConnection(userId, clientId, now);
  }

  getOAuthConnection(
    userId: string,
    connectionId: string,
  ): { id: string; clientId: string; status: string } | undefined {
    return this.oauth.getOAuthConnection(userId, connectionId);
  }

  isStrictVisibilityEnabled(userId: string): boolean {
    return this.oauth.isStrictVisibilityEnabled(userId);
  }

  listGrantedDevices(userId: string, connectionId: string): string[] {
    return this.oauth.listGrantedDevices(userId, connectionId);
  }

  isDeviceGranted(userId: string, connectionId: string, agentId: string): boolean {
    return this.oauth.isDeviceGranted(userId, connectionId, agentId);
  }

  /** Atomic account-owned update. First selection also ends acceptance of unbound legacy tokens. */
  setOAuthConnectionDevices(
    userId: string,
    connectionId: string,
    agentIds: string[],
    now: string,
  ): void {
    this.oauth.setOAuthConnectionDevices(userId, connectionId, agentIds, now);
  }

  revokeOAuthConnection(userId: string, connectionId: string, now: string): boolean {
    return this.oauth.revokeOAuthConnection(userId, connectionId, now);
  }

  listUserOAuthConnections(userId: string): Array<{
    id: string;
    clientId: string;
    clientName: string;
    status: string;
    createdAt: string;
    deviceIds: string[];
    redirectHosts: string[];
  }> {
    return this.oauth.listUserOAuthConnections(userId);
  }

  /** List only OAuth clients granted by this specific dashboard account. */
  listUserOAuthClients(
    userId: string,
    now: string,
  ): Array<{
    clientId: string;
    clientName: string;
    redirectHosts: string[];
    registeredAt: string;
    lastTokenAt: string;
    activeGrants: number;
    scopes: string[];
  }> {
    return this.oauth.listUserOAuthClients(userId, now);
  }

  /** Account-scoped disconnection: retain global DCR records and other users' grants. */
  revokeUserOAuthClientGrants(userId: string, clientId: string, now: string): number | undefined {
    return this.oauth.revokeUserOAuthClientGrants(userId, clientId, now);
  }

  countOAuthClients(): number {
    return this.oauth.countOAuthClients();
  }

  createRefreshToken(token: OAuthRefreshTokenRecord): void {
    this.oauth.createRefreshToken(token);
  }

  getRefreshTokenByHash(tokenHash: string): OAuthRefreshTokenRecord | undefined {
    return this.oauth.getRefreshTokenByHash(tokenHash);
  }

  /** Atomically consume and rotate. Replaying a consumed token revokes the family. */
  rotateRefreshToken(
    oldHash: string,
    clientId: string,
    successor: OAuthRefreshTokenRecord,
    now: string,
  ): boolean {
    return this.oauth.rotateRefreshToken(oldHash, clientId, successor, now);
  }

  /** Revoke all descendants of a credential without leaking whether it was valid. */
  revokeRefreshFamily(tokenHash: string, clientId: string, now: string): void {
    this.oauth.revokeRefreshFamily(tokenHash, clientId, now);
  }

  insertAuthorizationCode(code: OAuthAuthorizationCode): void {
    this.oauth.insertAuthorizationCode(code);
  }

  getAuthorizationCodeByHash(codeHash: string): OAuthAuthorizationCode | undefined {
    return this.oauth.getAuthorizationCodeByHash(codeHash);
  }

  markAuthorizationCodeUsed(codeHash: string, usedAt: string): void {
    this.oauth.markAuthorizationCodeUsed(codeHash, usedAt);
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
