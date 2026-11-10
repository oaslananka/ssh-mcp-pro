import type { DatabaseSync } from "node:sqlite";

/** Initialize remote storage with the existing, backward-compatible schema. */
export function migrateRemoteStoreSchema(db: DatabaseSync): void {
  const userColumns = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );

  if (userColumns.length > 0 && !userColumns.includes("google_id")) {
    db.exec(`
        CREATE TABLE users_migrated (
          id TEXT PRIMARY KEY,
          github_id TEXT,
          github_login TEXT,
          google_id TEXT,
          email TEXT,
          display_name TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT 'github',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO users_migrated (id, github_id, github_login, display_name, provider, created_at, updated_at)
          SELECT id, github_id, github_login, github_login, 'github', created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
      `);
  } else if (userColumns.length === 0) {
    db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          github_id TEXT,
          github_login TEXT,
          google_id TEXT,
          email TEXT,
          display_name TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT 'github',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
      `);
  }

  db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expiry ON dashboard_sessions(expires_at);

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

      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        scope TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_oauth_refresh_expiry ON oauth_refresh_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family ON oauth_refresh_tokens(family_id);

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
