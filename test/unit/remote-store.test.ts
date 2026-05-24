import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { RemoteStore } from "../../src/remote/store.js";

const now = "2026-01-01T00:00:00.000Z";

describe("remote durable store", () => {
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
