import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { RemoteStore } from "../../src/remote/store.js";

const now = "2026-01-01T00:00:00.000Z";

describe("remote durable store", () => {
  test("persists only hashed rotating refresh credentials through SQLite restart and revocation", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-refresh-store-"));
    const databasePath = path.join(dir, "tokens.db");
    const base = {
      familyId: "family_1",
      clientId: "client_refresh",
      userId: "github:43",
      resource: "https://example.test/mcp",
      scope: "hosts:read",
      expiresAt: "2026-02-01T00:00:00.000Z",
      createdAt: now,
    };
    const secret = randomToken(32);
    const successor = randomToken(32);
    let store: RemoteStore | undefined;
    try {
      store = new RemoteStore("file:" + databasePath);
      store.upsertUser({ internalId: "github:43", id: "43", login: "tester", now });
      store.insertClient({
        id: "client_row",
        clientId: base.clientId,
        clientName: "Refresh Test",
        redirectUris: ["https://example.test/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      store.createRefreshToken({ ...base, tokenHash: hashSecret(secret) });
      store.close();
      store = undefined;

      const file = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const records = file.prepare("SELECT * FROM oauth_refresh_tokens").all();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          token_hash: hashSecret(secret),
          client_id: "client_refresh",
          user_id: "github:43",
        });
        expect(JSON.stringify(records)).not.toContain(secret);
        expect(file.prepare("PRAGMA integrity_check").get()).toMatchObject({
          integrity_check: "ok",
        });
        expect(file.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        file.close();
      }

      store = new RemoteStore(databasePath);
      const nextRecord = {
        ...base,
        tokenHash: hashSecret(successor),
        createdAt: "2026-01-02T00:00:00.000Z",
      };
      expect(
        store.rotateRefreshToken(
          hashSecret(secret),
          base.clientId,
          nextRecord,
          nextRecord.createdAt,
        ),
      ).toBe(true);
      expect(store.getRefreshTokenByHash(hashSecret(successor))).toMatchObject({
        userId: "github:43",
        scope: "hosts:read",
      });
      expect(
        store.rotateRefreshToken(
          hashSecret(secret),
          base.clientId,
          nextRecord,
          nextRecord.createdAt,
        ),
      ).toBe(false);
      expect(store.getRefreshTokenByHash(hashSecret(successor))?.revokedAt).toBeDefined();
      expect(
        store.rotateRefreshToken(
          hashSecret(successor),
          base.clientId,
          { ...nextRecord, tokenHash: hashSecret(randomToken(32)) },
          nextRecord.createdAt,
        ),
      ).toBe(false);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws actionable startup error when node:sqlite cannot provide DatabaseSync", () => {
    expect(
      () =>
        new RemoteStore(":memory:", {
          loadSqlite: () => ({ DatabaseSync: undefined }),
        }),
    ).toThrow("node:sqlite is not available in this Node.js build");
    expect(
      () =>
        new RemoteStore(":memory:", {
          loadSqlite: () => ({ DatabaseSync: undefined }),
        }),
    ).toThrow("This feature requires Node.js >=22.13.0");
    expect(
      () =>
        new RemoteStore(":memory:", {
          loadSqlite: () => ({ DatabaseSync: undefined }),
        }),
    ).toThrow("See ARCHITECTURE.md for the better-sqlite3 fallback path.");
  });

  test("migrates a legacy GitHub-only user table without losing account identity", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-legacy-schema-"));
    const databasePath = path.join(dir, "legacy.db");
    const legacy = new DatabaseSync(databasePath);
    try {
      legacy.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          github_id TEXT,
          github_login TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO users VALUES (
          'legacy_user', 'legacy_gh_id', 'prior-login',
          '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'
        );
      `);
    } finally {
      legacy.close();
    }

    let store: RemoteStore | undefined;
    try {
      store = new RemoteStore(databasePath);
      expect(store.getUserByGitHubId("legacy_gh_id")).toMatchObject({
        id: "legacy_user",
        githubId: "legacy_gh_id",
      });
      store.close();
      store = undefined;

      const migrated = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const columns = migrated.prepare("PRAGMA table_info(users)").all();
        expect(columns.some((column) => column.name === "google_id")).toBe(true);
        const identity = migrated.prepare("SELECT github_id, github_login FROM users").get();
        expect(identity).toMatchObject({
          github_id: "legacy_gh_id",
          github_login: "prior-login",
        });
      } finally {
        migrated.close();
      }
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("physically prunes only expired session, auth-code and enrollment rows", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-expiry-"));
    const databasePath = path.join(dir, "expiry.db");
    const store = new RemoteStore("file:" + databasePath);
    const before = "2026-01-01T00:04:59.999Z";
    const cutoff = "2026-01-01T00:05:00.000Z";
    const after = "2026-01-01T00:05:00.001Z";
    try {
      store.upsertUser({ internalId: "usr_expiry", id: "provider_expiry", login: "tester", now });
      store.insertAudit({
        id: "aud_expiry",
        userId: "usr_expiry",
        eventType: "agent_enrolled",
        severity: "info",
        metadata: { test: true },
        createdAt: before,
      });
      store.insertClient({
        id: "client_row",
        clientId: "client_expiry",
        clientName: "Test Client",
        redirectUris: ["https://example.org/callback"],
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: before,
      });

      for (const [suffix, expiresAt] of [
        ["old", before],
        ["edge", cutoff],
        ["live", after],
      ]) {
        store.createDashboardSession("session_" + suffix, "usr_expiry", expiresAt, before);
        store.insertAuthorizationCode({
          id: "code_" + suffix,
          codeHash: "codehash_" + suffix,
          clientId: "client_expiry",
          userId: "usr_expiry",
          redirectUri: "https://example.org/callback",
          codeChallenge: "pkce",
          codeChallengeMethod: "S256",
          resource: "https://example.org/mcp",
          scope: "hosts:read",
          expiresAt,
          createdAt: before,
        });
        store.insertEnrollmentToken({
          id: "enroll_" + suffix,
          agentId: "device_expiry",
          userId: "usr_expiry",
          tokenHash: "enrollhash_" + suffix,
          expiresAt,
          createdAt: before,
        });
      }
      // Even a consumed token is not deleted early solely because it was used.
      store.markAuthorizationCodeUsed("codehash_live", before);
      store.markEnrollmentTokenUsed("enrollhash_live", before);

      store.pruneExpiredTransientRecords(cutoff);
      store.pruneExpiredTransientRecords(cutoff); // safe to retry

      const database = new DatabaseSync(databasePath);
      try {
        for (const [table, prefix] of [
          ["dashboard_sessions", "session_"],
          ["oauth_authorization_codes", "code_"],
          ["agent_enrollment_tokens", "enroll_"],
        ]) {
          const column = table === "dashboard_sessions" ? "token_hash" : "id";
          const rows = database.prepare("SELECT " + column + " FROM " + table).all();
          expect(rows.map((row) => row[column])).toEqual([prefix + "live"]);
        }
      } finally {
        database.close();
      }

      expect(store.getDashboardSession("session_live", cutoff)).toEqual({
        userId: "usr_expiry",
      });
      expect(store.getAuthorizationCodeByHash("codehash_live")?.usedAt).toBe(before);
      expect(store.getEnrollmentTokenByHash("enrollhash_live")?.usedAt).toBe(before);
      expect(store.getUserByGitHubId("provider_expiry")?.id).toBe("usr_expiry");
      expect(store.getClient("client_expiry")?.clientName).toBe("Test Client");
      expect(store.listAudit("usr_expiry", undefined, 10)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("enforces single-use authorization codes atomically", () => {
    const store = new RemoteStore(":memory:");
    store.insertAuthorizationCode({
      id: "code_row",
      codeHash: "code_hash",
      clientId: "cli_test",
      userId: "usr_test",
      redirectUri: "https://example.com/callback",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      resource: "https://example.com/mcp",
      scope: "hosts:read",
      expiresAt: "2026-01-01T00:05:00.000Z",
      createdAt: now,
    });

    store.markAuthorizationCodeUsed("code_hash", now);

    let conflict: unknown;
    try {
      store.markAuthorizationCodeUsed("code_hash", now);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({
      code: "INVALID_TOKEN",
      message: "Authorization code already used",
      status: 400,
    });
    store.close();
  });

  test("enforces single-use enrollment tokens atomically", () => {
    const store = new RemoteStore(":memory:");
    store.insertEnrollmentToken({
      id: "enr_test",
      agentId: "agt_test",
      userId: "usr_test",
      tokenHash: "token_hash",
      expiresAt: "2026-01-01T00:05:00.000Z",
      createdAt: now,
    });

    store.markEnrollmentTokenUsed("token_hash", now);

    let conflict: unknown;
    try {
      store.markEnrollmentTokenUsed("token_hash", now);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({
      code: "INVALID_TOKEN",
      message: "Enrollment token already used",
      status: 400,
    });
    store.close();
  });

  test("counts registered OAuth clients for DCR bounding", () => {
    const store = new RemoteStore(":memory:");
    expect(store.countOAuthClients()).toBe(0);

    store.insertClient({
      id: "row_cli",
      clientId: "cli_test",
      clientName: "Test Client",
      redirectUris: ["https://example.com/callback"],
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      createdAt: now,
    });

    expect(store.countOAuthClients()).toBe(1);
    store.insertAgent({
      id: "agt_test",
      userId: "usr_test",
      alias: "local-test",
      status: "pending",
      profile: "read-only",
      policy: createAgentPolicy("read-only"),
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(store.countOAuthClients()).toBe(1);
    store.close();
  });

  test("persists users, clients, agents, and audit events across process restarts", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-store-"));
    try {
      const databaseUrl = `file:${path.join(dir, "remote.db")}`;
      const policy = createAgentPolicy("operations");
      const store = new RemoteStore(databaseUrl);
      store.upsertUser({
        internalId: "usr_1",
        id: "169144131",
        login: "oaslananka",
        now,
      });
      store.insertClient({
        id: "row_cli_restart",
        clientId: "cli_restart",
        clientName: "Restart Client",
        redirectUris: ["https://chatgpt.com/callback"],
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      store.insertAgent({
        id: "agt_restart",
        userId: "usr_1",
        alias: "prod-vps",
        status: "online",
        publicKey: "public-key",
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        hostMetadata: {
          hostname: "prod-vps",
          os: "Linux",
          arch: "x64",
          platform: "linux",
        },
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      store.insertAudit({
        id: "aud_restart",
        userId: "usr_1",
        agentId: "agt_restart",
        actionId: "act_restart",
        eventType: "action_completed",
        severity: "info",
        metadata: { status: "ok" },
        createdAt: now,
      });
      store.close();

      const reopened = new RemoteStore(databaseUrl);
      try {
        expect(reopened.getUserByGitHubId("169144131")).toMatchObject({
          id: "usr_1",
          githubLogin: "oaslananka",
        });
        expect(reopened.getClient("cli_restart")).toMatchObject({
          clientName: "Restart Client",
          redirectUris: ["https://chatgpt.com/callback"],
        });
        expect(reopened.getAgentByAlias("usr_1", "prod-vps")).toMatchObject({
          id: "agt_restart",
          status: "online",
          hostMetadata: expect.objectContaining({ hostname: "prod-vps" }),
        });
        expect(reopened.listAudit("usr_1", "agt_restart", 10)).toEqual([
          expect.objectContaining({
            id: "aud_restart",
            eventType: "action_completed",
            metadata: { status: "ok" },
          }),
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bounds audit reads and filters by agent without leaking other agents", () => {
    const store = new RemoteStore(":memory:");
    try {
      for (let index = 0; index < 210; index += 1) {
        store.insertAudit({
          id: `aud_a_${index.toString().padStart(3, "0")}`,
          userId: "usr_1",
          agentId: "agt_a",
          eventType: "action_completed",
          severity: "info",
          metadata: { index },
          createdAt: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
        });
      }
      store.insertAudit({
        id: "aud_b_secret",
        userId: "usr_1",
        agentId: "agt_b",
        eventType: "action_completed",
        severity: "info",
        metadata: { agent: "b" },
        createdAt: "2026-01-01T01:00:00.000Z",
      });

      const unfiltered = store.listAudit("usr_1", undefined, 10_000);
      expect(unfiltered).toHaveLength(200);
      expect(unfiltered[0]?.id).toBe("aud_b_secret");

      const filtered = store.listAudit("usr_1", "agt_a", 10_000);
      expect(filtered).toHaveLength(200);
      expect(filtered.every((event) => event.agentId === "agt_a")).toBe(true);
      expect(filtered.map((event) => event.id)).not.toContain("aud_b_secret");
    } finally {
      store.close();
    }
  });
});
