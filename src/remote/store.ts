import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { migrateRemoteStoreSchema } from "./store-schema.js";
import { prepareRemoteStoreFile } from "./store-file-permissions.js";
import {
  REVIEWER_DEMO_USER_ID,
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
    const DatabaseSync = resolveDatabaseSync(options.loadSqlite);
    if (filePath !== ":memory:") prepareRemoteStoreFile(filePath);
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    migrateRemoteStoreSchema(this.db);
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
    const count = (sql: string): number => Number((this.db.prepare(sql).get() as { n: number }).n);
    const accounts = this.db
      .prepare(
        `SELECT u.provider,
              CASE WHEN u.provider = 'github' THEN u.github_login
                   ELSE COALESCE(u.email, 'Google account') END AS label,
              (SELECT COUNT(*) FROM agents a WHERE a.user_id = u.id) AS agents,
              (SELECT COUNT(*) FROM actions ac WHERE ac.user_id = u.id) AS actions,
              (SELECT MAX(ac.issued_at) FROM actions ac WHERE ac.user_id = u.id) AS lastActionAt
       FROM users u
       WHERE u.provider <> 'demo'
       ORDER BY u.created_at DESC LIMIT 100`,
      )
      .all() as Array<{
      provider: string;
      label: string;
      agents: number;
      actions: number;
      lastActionAt: string | null;
    }>;
    return {
      registeredUsers: count("SELECT COUNT(*) AS n FROM users WHERE provider <> 'demo'"),
      registeredAgents: count("SELECT COUNT(*) AS n FROM agents"),
      totalActions: count("SELECT COUNT(*) AS n FROM actions"),
      actionsLast7Days: count(
        "SELECT COUNT(*) AS n FROM actions WHERE issued_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')",
      ),
      actionsLast30Days: count(
        "SELECT COUNT(*) AS n FROM actions WHERE issued_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')",
      ),
      completedActions: count("SELECT COUNT(*) AS n FROM actions WHERE status = 'completed'"),
      failedActions: count(
        "SELECT COUNT(*) AS n FROM actions WHERE status IN ('error', 'timeout')",
      ),
      accounts,
    };
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
    const now = new Date();
    const monthNames = [
      "Oca",
      "Şub",
      "Mar",
      "Nis",
      "May",
      "Haz",
      "Tem",
      "Ağu",
      "Eyl",
      "Eki",
      "Kas",
      "Ara",
    ];
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const daysRemaining = Math.max(
      0,
      Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const daysElapsed = Math.max(1, now.getUTCDate());

    const monthRow = this.db
      .prepare("SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND issued_at >= ?")
      .get(userId, startOfMonth) as { n: number } | undefined;
    const callsThisMonth = Number(monthRow?.n ?? 0);
    const limit = 10_000;
    const dailyAverage = Math.round(callsThisMonth / daysElapsed);
    const percentUsed = Math.min(100, Math.round((callsThisMonth / limit) * 100));
    const resetDate = `1 ${monthNames[nextMonth.getUTCMonth()] ?? "Gelecek Ay"}`;

    const callsOverTime: Array<{ month: string; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const mDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const mStart = mDate.toISOString();
      const mEnd = new Date(
        Date.UTC(mDate.getUTCFullYear(), mDate.getUTCMonth() + 1, 1),
      ).toISOString();
      const countRow = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND issued_at >= ? AND issued_at < ?",
        )
        .get(userId, mStart, mEnd) as { n: number } | undefined;
      const count = Number(countRow?.n ?? 0);
      callsOverTime.push({
        month: monthNames[mDate.getUTCMonth()] ?? "",
        count,
      });
    }

    return {
      callsThisMonth,
      limit,
      dailyAverage,
      daysElapsed,
      daysRemaining,
      percentUsed,
      resetDate,
      callsOverTime,
    };
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

  upsertReviewerUser(now: string): void {
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, provider, created_at, updated_at)
         VALUES (?, 'OpenAI Reviewer (Sample Tenant)', 'demo', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(REVIEWER_DEMO_USER_ID, now, now);
    if (this.getUserById(REVIEWER_DEMO_USER_ID)?.provider !== "demo") {
      throw new Error("Reserved reviewer identity is already owned by another provider");
    }
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
        provider: "github" | "google" | "demo";
      }
    | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    const provider = optionalRowString(row, "provider");
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
      provider: provider === "google" || provider === "demo" ? provider : "github",
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

  /** Authorization identity is connection-specific, not the shared OAuth registration. */
  createOAuthConnection(userId: string, clientId: string, now: string): string {
    const connectionId = "con_" + randomUUID().replaceAll("-", "");
    this.db
      .prepare(
        "INSERT INTO oauth_connections (id, user_id, client_id, status, created_at) " +
          "VALUES (?, ?, ?, 'active', ?)",
      )
      .run(connectionId, userId, clientId, now);
    return connectionId;
  }

  getOAuthConnection(
    userId: string,
    connectionId: string,
  ): { id: string; clientId: string; status: string } | undefined {
    return this.db
      .prepare(
        "SELECT id, client_id AS clientId, status FROM oauth_connections WHERE user_id = ? AND id = ?",
      )
      .get(userId, connectionId) as { id: string; clientId: string; status: string } | undefined;
  }

  isStrictVisibilityEnabled(userId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM oauth_visibility_users WHERE user_id = ?").get(userId);
  }

  listGrantedDevices(userId: string, connectionId: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT d.agent_id AS id FROM oauth_connection_devices d " +
            "JOIN oauth_connections c ON c.id = d.connection_id " +
            "JOIN agents a ON a.id = d.agent_id " +
            "WHERE c.user_id = ? AND c.id = ? AND c.status = 'active' " +
            "AND a.user_id = ? AND a.status <> 'revoked' ORDER BY d.agent_id",
        )
        .all(userId, connectionId, userId) as Array<{ id: string }>
    ).map((row) => row.id);
  }

  isDeviceGranted(userId: string, connectionId: string, agentId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM oauth_connection_devices d " +
          "JOIN oauth_connections c ON c.id = d.connection_id " +
          "JOIN agents a ON a.id = d.agent_id " +
          "WHERE c.user_id = ? AND c.id = ? AND c.status = 'active' " +
          "AND d.agent_id = ? AND a.user_id = ? AND a.status <> 'revoked'",
      )
      .get(userId, connectionId, agentId, userId);
  }

  /** Atomic account-owned update. First selection also ends acceptance of unbound legacy tokens. */
  setOAuthConnectionDevices(
    userId: string,
    connectionId: string,
    agentIds: string[],
    now: string,
  ): void {
    if (
      agentIds.length > 100 ||
      new Set(agentIds).size !== agentIds.length ||
      agentIds.some(
        (deviceId) => typeof deviceId !== "string" || !/^agt_[A-Za-z0-9_-]{1,100}$/.test(deviceId),
      )
    ) {
      throw new TypeError("Invalid device selection");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const connection = this.getOAuthConnection(userId, connectionId);
      if (connection?.status !== "active") {
        throw new Error("AI connection is not available");
      }
      for (const agentId of agentIds) {
        if (
          !this.db
            .prepare("SELECT 1 FROM agents WHERE id = ? AND user_id = ? AND status <> 'revoked'")
            .get(agentId, userId)
        ) {
          throw new Error("Device does not belong to this account");
        }
      }
      this.db
        .prepare("DELETE FROM oauth_connection_devices WHERE connection_id = ?")
        .run(connectionId);
      const insert = this.db.prepare(
        "INSERT INTO oauth_connection_devices (connection_id, agent_id) VALUES (?, ?)",
      );
      for (const agentId of agentIds) insert.run(connectionId, agentId);
      this.db
        .prepare("INSERT OR IGNORE INTO oauth_visibility_users (user_id, enabled_at) VALUES (?, ?)")
        .run(userId, now);
      // Once strict visibility is enabled, unbound legacy credentials must reauthorize.
      this.db
        .prepare(
          "UPDATE oauth_refresh_tokens SET revoked_at = ? " +
            "WHERE user_id = ? AND connection_id IS NULL AND revoked_at IS NULL",
        )
        .run(now, userId);
      this.db
        .prepare(
          "UPDATE oauth_authorization_codes SET used_at = ? " +
            "WHERE user_id = ? AND connection_id IS NULL AND used_at IS NULL",
        )
        .run(now, userId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  revokeOAuthConnection(userId: string, connectionId: string, now: string): boolean {
    const updated = this.db
      .prepare(
        "UPDATE oauth_connections SET status = 'revoked', revoked_at = ? " +
          "WHERE id = ? AND user_id = ? AND status = 'active'",
      )
      .run(now, connectionId, userId);
    this.db
      .prepare(
        "UPDATE oauth_refresh_tokens SET revoked_at = ? " +
          "WHERE user_id = ? AND connection_id = ? AND revoked_at IS NULL",
      )
      .run(now, userId, connectionId);
    return Number(updated.changes) === 1;
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
    const records = this.db
      .prepare(
        "SELECT c.id, c.client_id AS clientId, c.status, c.created_at AS createdAt, " +
          "o.client_name AS clientName, o.redirect_uris AS redirectUris " +
          "FROM oauth_connections c JOIN oauth_clients o ON o.client_id = c.client_id " +
          "WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 100",
      )
      .all(userId) as Array<{
      id: string;
      clientId: string;
      status: string;
      createdAt: string;
      clientName: string | null;
      redirectUris: string;
    }>;
    return records.map((record) => ({
      id: record.id,
      clientId: record.clientId,
      clientName: record.clientName?.trim() ?? "AI connection",
      status: record.status,
      createdAt: record.createdAt,
      deviceIds: this.listGrantedDevices(userId, record.id),
      redirectHosts: [
        ...new Set(
          parseJson<string[]>(record.redirectUris).flatMap((uri) => {
            try {
              return [new URL(uri).hostname];
            } catch {
              return [];
            }
          }),
        ),
      ],
    }));
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
    const rows = this.db
      .prepare(
        "SELECT c.client_id AS clientId, c.client_name AS clientName, " +
          "c.redirect_uris AS redirectUris, c.created_at AS registeredAt, " +
          "MAX(t.created_at) AS lastTokenAt, " +
          "COUNT(DISTINCT CASE WHEN t.revoked_at IS NULL AND t.used_at IS NULL " +
          "AND t.expires_at > ? THEN t.family_id END) AS activeGrants, " +
          "GROUP_CONCAT(DISTINCT CASE WHEN t.revoked_at IS NULL AND t.used_at IS NULL " +
          "AND t.expires_at > ? THEN t.scope END) AS activeScopes " +
          "FROM oauth_clients c JOIN oauth_refresh_tokens t ON t.client_id = c.client_id " +
          "WHERE t.user_id = ? GROUP BY c.client_id " +
          "ORDER BY MAX(t.created_at) DESC LIMIT 100",
      )
      .all(now, now, userId) as Array<{
      clientId: string;
      clientName: string | null;
      redirectUris: string;
      registeredAt: string;
      lastTokenAt: string;
      activeGrants: number;
      activeScopes: string | null;
    }>;
    return rows.map((row) => ({
      clientId: row.clientId,
      clientName: row.clientName?.trim() ? row.clientName : "Unnamed AI client",
      redirectHosts: [
        ...new Set(
          parseJson<string[]>(row.redirectUris).flatMap((uri) => {
            try {
              return [new URL(uri).hostname];
            } catch {
              return [];
            }
          }),
        ),
      ],
      registeredAt: row.registeredAt,
      lastTokenAt: row.lastTokenAt,
      activeGrants: Number(row.activeGrants),
      scopes: [
        ...new Set(
          (row.activeScopes ?? "")
            .split(",")
            .flatMap((scope) => scope.split(/\s+/u))
            .filter(Boolean),
        ),
      ],
    }));
  }

  /** Account-scoped disconnection: retain global DCR records and other users' grants. */
  revokeUserOAuthClientGrants(userId: string, clientId: string, now: string): number | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const known = this.db
        .prepare("SELECT 1 FROM oauth_refresh_tokens WHERE user_id = ? AND client_id = ? LIMIT 1")
        .get(userId, clientId);
      if (!known) {
        this.db.exec("COMMIT");
        return undefined;
      }
      const result = this.db
        .prepare(
          "UPDATE oauth_refresh_tokens SET revoked_at = ? " +
            "WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
        )
        .run(now, userId, clientId);
      this.db
        .prepare(
          "UPDATE oauth_connections SET status = 'revoked', revoked_at = ? " +
            "WHERE user_id = ? AND client_id = ? AND status = 'active'",
        )
        .run(now, userId, clientId);
      // Invalidate unredeemed authorization codes from the same account.
      this.db
        .prepare(
          "UPDATE oauth_authorization_codes SET used_at = ? " +
            "WHERE user_id = ? AND client_id = ? AND used_at IS NULL",
        )
        .run(now, userId, clientId);
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
          "(token_hash, family_id, client_id, user_id, resource, scope, expires_at, used_at, revoked_at, created_at, connection_id) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
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
        token.connectionId ?? null,
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
      connectionId: optionalRowString(row, "connection_id"),
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
        previous.connectionId !== successor.connectionId ||
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
         (id, code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, expires_at, used_at, created_at, connection_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        code.connectionId ?? null,
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
      connectionId: optionalRowString(row, "connection_id"),
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
