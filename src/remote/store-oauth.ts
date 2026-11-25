import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { OAuthAuthorizationCode, OAuthRefreshTokenRecord, OAuthClient } from "./types.js";
import { parseJson, rowString, optionalRowString, tokenUseConflict } from "./store-row-values.js";

export class RemoteOAuthStore {
  constructor(private readonly db: DatabaseSync) {}

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
}
