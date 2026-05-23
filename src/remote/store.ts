import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  ActionRecord,
  AgentEnrollmentTokenRecord,
  AuditEvent,
  GitHubUser,
  OAuthAuthorizationCode,
  OAuthClient,
  RemoteAgentRecord,
} from "./types.js";

type SqlValue = string | number | null;
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

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
  return String(row[key] ?? "");
}

function optionalRowString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenUseConflict(message: string): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code: "INVALID_TOKEN", status: 400 });
}

export class RemoteStore {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(databaseUrl: string) {
    const filePath = dbPathFromUrl(databaseUrl);
    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_id TEXT UNIQUE NOT NULL,
        github_login TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS oauth_clients (
        id TEXT PRIMARY KEY,
        client_id TEXT UNIQUE NOT NULL,
        client_name TEXT,
        redirect_uris TEXT NOT NULL,
        grant_types TEXT NOT NULL,
        response_types TEXT NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT UNIQUE NOT NULL,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        resource TEXT NOT NULL,
        scope TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        status TEXT NOT NULL,
        public_key TEXT,
        profile TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        policy_version INTEGER NOT NULL DEFAULT 1,
        host_metadata_json TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, alias)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_enrollment_tokens (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        capability TEXT NOT NULL,
        args_json TEXT NOT NULL,
        status TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        deadline TEXT NOT NULL,
        completed_at TEXT,
        result_json TEXT,
        error_code TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        agent_id TEXT,
        action_id TEXT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  upsertUser(user: GitHubUser & { internalId: string; now: string }): void {
    this.db
      .prepare(
        `INSERT INTO users (id, github_id, github_login, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(github_id) DO UPDATE SET github_login = excluded.github_login, updated_at = excluded.updated_at`,
      )
      .run(user.internalId, user.id, user.login, user.now, user.now);
  }

  getUserByGitHubId(
    githubId: string,
  ): { id: string; githubId: string; githubLogin: string } | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE github_id = ?").get(githubId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: rowString(row, "id"),
      githubId: rowString(row, "github_id"),
      githubLogin: rowString(row, "github_login"),
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
      | Record<string, unknown>
      | undefined;
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

  countOAuthClients(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM oauth_clients").get() as
      | Record<string, unknown>
      | undefined;
    return Number(row?.count ?? 0);
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
      | Record<string, unknown>
      | undefined;
    return row ? this.agentFromRow(row) : undefined;
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
