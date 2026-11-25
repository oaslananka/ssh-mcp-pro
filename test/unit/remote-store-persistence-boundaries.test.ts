import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { RemoteAccountStore } from "../../src/remote/store-accounts.js";
import { RemoteOAuthStore } from "../../src/remote/store-oauth.js";
import { migrateRemoteStoreSchema } from "../../src/remote/store-schema.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";

const now = "2026-01-01T00:00:00.000Z";
const expires = "2026-02-01T00:00:00.000Z";

describe("remote store persistence boundaries", () => {
  test("shares one database while preserving identity, expiry and atomic OAuth ownership checks", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      migrateRemoteStoreSchema(db);
      const accounts = new RemoteAccountStore(db);
      const oauth = new RemoteOAuthStore(db);
      accounts.upsertUser({ internalId: "github:1", id: "1", login: "account-one", now });
      accounts.upsertUser({ internalId: "github:2", id: "2", login: "account-two", now });
      expect(accounts.getUserById("github:1")).toMatchObject({
        provider: "github",
        githubLogin: "account-one",
      });
      const sessionHash = hashSecret(randomToken(32));
      accounts.createDashboardSession(sessionHash, "github:1", expires, now);
      expect(accounts.getDashboardSession(sessionHash, now)).toEqual({ userId: "github:1" });
      expect(accounts.getDashboardSession(sessionHash, expires)).toBeUndefined();

      oauth.insertClient({
        id: "client-row",
        clientId: "client-fixture",
        clientName: "Fixture client",
        redirectUris: ["https://example.test/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      const connection = oauth.createOAuthConnection("github:1", "client-fixture", now);
      expect(oauth.getOAuthConnection("github:2", connection)).toBeUndefined();
      expect(() => oauth.setOAuthConnectionDevices("github:2", connection, [], now)).toThrow(
        "AI connection is not available",
      );
      expect(oauth.isStrictVisibilityEnabled("github:2")).toBe(false);
      expect(() =>
        oauth.setOAuthConnectionDevices("github:1", connection, ["agt_missing"], now),
      ).toThrow("Device does not belong to this account");
      expect(oauth.isStrictVisibilityEnabled("github:1")).toBe(false);
      oauth.setOAuthConnectionDevices("github:1", connection, [], now);
      expect(oauth.isStrictVisibilityEnabled("github:1")).toBe(true);
      expect(oauth.listGrantedDevices("github:1", connection)).toEqual([]);
      expect(oauth.listUserOAuthConnections("github:2")).toEqual([]);
      expect(oauth.revokeOAuthConnection("github:2", connection, now)).toBe(false);
      expect(oauth.getOAuthConnection("github:1", connection)?.status).toBe("active");
      expect(oauth.revokeOAuthConnection("github:1", connection, now)).toBe(true);
      expect(oauth.getOAuthConnection("github:1", connection)?.status).toBe("revoked");

      accounts.deleteDashboardSession(sessionHash);
      expect(accounts.getDashboardSession(sessionHash, now)).toBeUndefined();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
