import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { captureResponse, request, testConfig } from "../helpers/web-dashboard-fixture.js";

describe("account-scoped AI OAuth clients dashboard", () => {
  test("lists real grants, enforces tenant isolation and revokes refresh permissions", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-ai-clients-test-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const tokenA = randomToken(32);
      const tokenB = randomToken(32);
      const dashboardA = randomToken(32);
      const dashboardB = randomToken(32);
      cp.store.upsertUser({ internalId: "github:101", id: "101", login: "alice", now });
      cp.store.upsertUser({ internalId: "github:202", id: "202", login: "bob", now });
      cp.store.createDashboardSession(hashSecret(dashboardA), "github:101", future, now);
      cp.store.createDashboardSession(hashSecret(dashboardB), "github:202", future, now);
      for (const [clientId, name, host] of [
        ["client_shared", "ChatGPT", "chatgpt.com"],
        ["client_bobonly", "Claude", "claude.ai"],
      ]) {
        cp.store.insertClient({
          id: "row_" + clientId,
          clientId,
          clientName: name,
          redirectUris: ["https://" + host + "/oauth/callback?secret=hidden"],
          grantTypes: ["authorization_code", "refresh_token"],
          responseTypes: ["code"],
          tokenEndpointAuthMethod: "none",
          createdAt: now,
        });
      }
      for (const [hash, clientId, userId, family, scope] of [
        [hashSecret(tokenA), "client_shared", "github:101", "family_a", "hosts:read agents:read"],
        [hashSecret(tokenB), "client_shared", "github:202", "family_b", "hosts:read files:write"],
        [hashSecret(randomToken(32)), "client_bobonly", "github:202", "family_c", "hosts:read"],
      ]) {
        cp.store.createRefreshToken({
          tokenHash: hash,
          familyId: family,
          clientId,
          userId,
          resource: "http://127.0.0.1:3000/mcp",
          scope,
          expiresAt: future,
          createdAt: now,
        });
      }

      const codeA = hashSecret(randomToken(32));
      const codeB = hashSecret(randomToken(32));
      for (const [codeHash, userId, id] of [
        [codeA, "github:101", "a"],
        [codeB, "github:202", "b"],
      ]) {
        cp.store.insertAuthorizationCode({
          id: "code_" + id,
          codeHash,
          clientId: "client_shared",
          userId,
          redirectUri: "https://chatgpt.com/oauth/callback",
          codeChallenge: "synthetic-challenge",
          codeChallengeMethod: "S256",
          resource: "http://127.0.0.1:3000/mcp",
          scope: "hosts:read",
          expiresAt: future,
          createdAt: now,
        });
      }

      const getClients = async (token?: string) => {
        const endpoint = "/api/dashboard/ai-clients";
        const res = captureResponse();
        await cp.handleHttp(
          request("GET", endpoint, token ? { cookie: "ssh_mcp_web_session=" + token } : {}),
          res as unknown as ServerResponse,
          endpoint,
        );
        return res;
      };

      const anonymous = await getClients();
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.getHeader("cache-control")).toContain("no-store");

      const listA = await getClients(dashboardA);
      expect(listA.statusCode).toBe(200);
      expect(listA.getHeader("cache-control")).toContain("no-store");
      const alice = JSON.parse(listA.body).clients;
      expect(alice).toHaveLength(1);
      expect(alice[0]).toMatchObject({
        clientId: "client_shared",
        clientName: "ChatGPT",
        redirectHosts: ["chatgpt.com"],
        activeGrants: 1,
        scopes: ["hosts:read", "agents:read"],
      });
      expect(JSON.stringify(alice)).not.toContain("secret=hidden");
      expect(JSON.stringify(alice)).not.toContain(hashSecret(tokenA));

      const bob = JSON.parse((await getClients(dashboardB)).body).clients;
      expect(bob).toHaveLength(2);
      expect(
        bob.find((c: { clientId: string }) => c.clientId === "client_shared").scopes,
      ).toContain("files:write");

      const endpoint = "/api/dashboard/ai-clients/client_shared/revoke";
      await expect(
        cp.handleHttp(
          request("POST", endpoint, { cookie: "ssh_mcp_web_session=" + dashboardA }),
          captureResponse() as unknown as ServerResponse,
          endpoint,
        ),
      ).rejects.toMatchObject({ status: 403 });

      const post = async (url: string, session: string, method = "POST") => {
        const res = captureResponse();
        await cp.handleHttp(
          request(method, url, {
            cookie: "ssh_mcp_web_session=" + session,
            origin: "http://127.0.0.1:3000",
            "x-ssh-mcp-dashboard": "1",
            "sec-fetch-site": "same-origin",
          }),
          res as unknown as ServerResponse,
          url,
        );
        return res;
      };
      expect(
        (await post("/api/dashboard/ai-clients/client_bobonly/revoke", dashboardA)).statusCode,
      ).toBe(404);
      const removeEndpoint = "/api/dashboard/ai-clients/client_shared";
      expect(alice[0].canRemove).toBe(false);
      expect((await post(removeEndpoint, dashboardA, "DELETE")).statusCode).toBe(409);
      expect(
        (await post("/api/dashboard/ai-clients/client_bobonly", dashboardA, "DELETE")).statusCode,
      ).toBe(404);
      const revoked = await post(endpoint, dashboardA);
      expect(revoked.statusCode).toBe(200);
      expect(JSON.parse(revoked.body)).toEqual({ revokedRefreshTokens: 1 });
      expect(cp.store.getRefreshTokenByHash(hashSecret(tokenA))?.revokedAt).toBeTruthy();
      expect(cp.store.getAuthorizationCodeByHash(codeA)?.usedAt).toBeTruthy();
      expect(cp.store.getAuthorizationCodeByHash(codeB)?.usedAt).toBeUndefined();
      expect(cp.store.getRefreshTokenByHash(hashSecret(tokenB))?.revokedAt).toBeUndefined();
      expect(JSON.parse((await getClients(dashboardA)).body).clients[0].activeGrants).toBe(0);
      expect(JSON.parse((await getClients(dashboardB)).body).clients).toHaveLength(2);
      expect(JSON.parse((await post(endpoint, dashboardA)).body)).toEqual({
        revokedRefreshTokens: 0,
      });
      expect(JSON.parse((await getClients(dashboardA)).body).clients[0].canRemove).toBe(true);
      const connection = cp.store.createOAuthConnection("github:101", "client_shared", now);
      expect(JSON.parse((await getClients(dashboardA)).body).clients[0].canRemove).toBe(false);
      expect((await post(removeEndpoint, dashboardA, "DELETE")).statusCode).toBe(409);
      cp.store.revokeOAuthConnection("github:101", connection, now);
      const pendingCode = hashSecret(randomToken(32));
      cp.store.insertAuthorizationCode({
        id: "pending",
        codeHash: pendingCode,
        clientId: "client_shared",
        userId: "github:101",
        redirectUri: "https://chatgpt.com/oauth/callback",
        codeChallenge: "synthetic-challenge",
        codeChallengeMethod: "S256",
        resource: "http://127.0.0.1:3000/mcp",
        scope: "hosts:read",
        expiresAt: future,
        createdAt: now,
      });
      expect(JSON.parse((await getClients(dashboardA)).body).clients[0].canRemove).toBe(false);
      expect((await post(removeEndpoint, dashboardA, "DELETE")).statusCode).toBe(409);
      await post(endpoint, dashboardA);
      await expect(
        cp.handleHttp(
          request("DELETE", removeEndpoint, { cookie: "ssh_mcp_web_session=" + dashboardA }),
          captureResponse() as unknown as ServerResponse,
          removeEndpoint,
        ),
      ).rejects.toMatchObject({ status: 403 });
      const removed = await post(removeEndpoint, dashboardA, "DELETE");
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toEqual({ removed: true, clientId: "client_shared" });
      expect(JSON.parse((await getClients(dashboardA)).body).clients).toEqual([]);
      expect(cp.store.getClient("client_shared")).toBeDefined();
      expect(cp.store.getOAuthConnection("github:101", connection)?.status).toBe("revoked");
      expect(cp.store.getRefreshTokenByHash(hashSecret(tokenA))).toBeUndefined();
      expect(cp.store.getAuthorizationCodeByHash(codeA)).toBeUndefined();
      expect(cp.store.getAuthorizationCodeByHash(pendingCode)).toBeUndefined();
      expect(cp.store.getRefreshTokenByHash(hashSecret(tokenB))?.revokedAt).toBeUndefined();
      expect(cp.store.getAuthorizationCodeByHash(codeB)).toBeDefined();
      expect(JSON.parse((await getClients(dashboardB)).body).clients).toHaveLength(2);
      expect((await post(removeEndpoint, dashboardA, "DELETE")).statusCode).toBe(404);
      expect(
        cp.store.listAudit("github:101", undefined, 20).map((event) => event.eventType),
      ).toContain("oauth_client_history_removed");
      expect(
        cp.store
          .listAudit("github:101", undefined, 20)
          .filter((event) => event.eventType === "oauth_client_grants_revoked"),
      ).toHaveLength(1);
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
