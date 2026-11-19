import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { RemoteStore } from "../../src/remote/store.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";

describe("AI connection device access", () => {
  test("migrates existing token tables in place without deleting historical grants", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-ai-grants-upgrade-"));
    const dbPath = path.join(dir, "existing.db");
    const sqlite = new DatabaseSync(dbPath);
    try {
      sqlite.exec(
        "CREATE TABLE oauth_authorization_codes (" +
          "id TEXT, code_hash TEXT, client_id TEXT, user_id TEXT, redirect_uri TEXT, " +
          "code_challenge TEXT, code_challenge_method TEXT, resource TEXT, scope TEXT, " +
          "expires_at TEXT, used_at TEXT, created_at TEXT);" +
          "CREATE TABLE oauth_refresh_tokens (" +
          "token_hash TEXT, family_id TEXT, client_id TEXT, user_id TEXT, resource TEXT, " +
          "scope TEXT, expires_at TEXT, used_at TEXT, revoked_at TEXT, created_at TEXT);",
      );
      sqlite
        .prepare("INSERT INTO oauth_refresh_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          "hash_previous",
          "fam",
          "cli_old",
          "github:1",
          "https://x.test/mcp",
          "agents:read",
          "2027-01-01T00:00:00Z",
          null,
          null,
          "2026-01-01T00:00:00Z",
        );
    } finally {
      sqlite.close();
    }
    const store = new RemoteStore(dbPath);
    try {
      const readOnly = new DatabaseSync(dbPath, { readOnly: true });
      try {
        for (const table of ["oauth_authorization_codes", "oauth_refresh_tokens"]) {
          expect(readOnly.prepare("PRAGMA table_info(" + table + ")").all()).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: "connection_id" })]),
          );
        }
        expect(
          readOnly.prepare("SELECT COUNT(*) AS count FROM oauth_refresh_tokens").get(),
        ).toMatchObject({ count: 1 });
        expect(readOnly.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        readOnly.close();
      }
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalidates old unbound refresh grants when first enabling visibility controls", () => {
    const store = new RemoteStore(":memory:");
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    try {
      store.upsertUser({ internalId: "github:1", id: "1", login: "alice", now });
      store.insertClient({
        id: "row_legacy",
        clientId: "cli_legacy",
        clientName: "Old AI",
        redirectUris: ["https://example.test/cb"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      const legacySecret = randomToken(32);
      store.createRefreshToken({
        tokenHash: hashSecret(legacySecret),
        familyId: "legacy_family",
        clientId: "cli_legacy",
        userId: "github:1",
        resource: "https://example.test/mcp",
        scope: "hosts:read",
        createdAt: now,
        expiresAt: future,
      });
      const connectionId = store.createOAuthConnection("github:1", "cli_legacy", now);
      expect(store.getRefreshTokenByHash(hashSecret(legacySecret))?.revokedAt).toBeUndefined();
      store.setOAuthConnectionDevices("github:1", connectionId, [], now);
      expect(store.getRefreshTokenByHash(hashSecret(legacySecret))?.revokedAt).toBe(now);
    } finally {
      store.close();
    }
  });

  test("starts with no devices and cannot select another owner's device", () => {
    const store = new RemoteStore(":memory:");
    const now = new Date().toISOString();
    const policy = createAgentPolicy("read-only");
    try {
      for (const [id, login] of [
        ["github:1", "alpha"],
        ["github:2", "beta"],
      ]) {
        store.upsertUser({ internalId: id, id: id.split(":")[1]!, login, now });
      }
      store.insertClient({
        id: "client_row",
        clientId: "cli_test",
        clientName: "Example",
        redirectUris: ["https://example.test/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      for (const [userId, id, alias] of [
        ["github:1", "agt_one", "one"],
        ["github:2", "agt_other", "other"],
      ]) {
        store.insertAgent({
          id,
          alias,
          userId,
          status: "offline",
          profile: policy.profile,
          policy,
          policyVersion: policy.version,
          createdAt: now,
          updatedAt: now,
        });
      }
      const one = store.createOAuthConnection("github:1", "cli_test", now);
      // A single registered OAuth client may have multiple independently scoped connections.
      const sameApp = store.createOAuthConnection("github:1", "cli_test", now);
      const other = store.createOAuthConnection("github:2", "cli_test", now);
      expect(sameApp).not.toBe(one);
      expect(store.listGrantedDevices("github:1", one)).toEqual([]);
      expect(store.isDeviceGranted("github:1", one, "agt_one")).toBe(false);
      expect(() => store.setOAuthConnectionDevices("github:1", one, ["agt_other"], now)).toThrow();
      expect(store.isStrictVisibilityEnabled("github:1")).toBe(false);
      store.setOAuthConnectionDevices("github:1", one, ["agt_one"], now);
      expect(store.isStrictVisibilityEnabled("github:1")).toBe(true);
      expect(store.isDeviceGranted("github:1", sameApp, "agt_one")).toBe(false);
      store.setOAuthConnectionDevices("github:1", sameApp, ["agt_one"], now);
      expect(store.isDeviceGranted("github:1", sameApp, "agt_one")).toBe(true);
      expect(store.listGrantedDevices("github:1", one)).toEqual(["agt_one"]);
      expect(store.isDeviceGranted("github:1", one, "agt_other")).toBe(false);
      expect(store.isDeviceGranted("github:2", other, "agt_one")).toBe(false);
      // Device removal/revocation never leaves a displayable or usable stale grant.
      const revoke = {
        id: "agt_one",
        alias: "one",
        userId: "github:1",
        status: "revoked" as const,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      store.updateAgent(revoke);
      expect(store.listGrantedDevices("github:1", one)).toEqual([]);
      expect(store.isDeviceGranted("github:1", one, "agt_one")).toBe(false);
      expect(() => store.setOAuthConnectionDevices("github:2", one, [], now)).toThrow();
      store.revokeOAuthConnection("github:1", one, now);
      expect(store.isDeviceGranted("github:1", one, "agt_one")).toBe(false);
      expect(store.getOAuthConnection("github:1", sameApp)?.status).toBe("active");
    } finally {
      store.close();
    }
  });
});
