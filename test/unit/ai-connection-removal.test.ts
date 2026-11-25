import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { captureResponse, request, testConfig } from "../helpers/web-dashboard-fixture.js";

describe("removing disconnected AI connections", () => {
  test("removes only revoked owned records and their credentials, retaining other grants and audit", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-ai-remove-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    try {
      const sessions = new Map<string, string>();
      for (const id of ["1", "2"]) {
        const userId = "github:" + id;
        cp.store.upsertUser({ internalId: userId, id, login: "fixture-" + id, now });
        const token = randomToken(32);
        cp.store.createDashboardSession(hashSecret(token), userId, future, now);
        sessions.set(userId, token);
      }
      const owner = "github:1",
        other = "github:2",
        clientId = "cli_shared";
      cp.store.insertClient({
        id: "row_shared",
        clientId,
        clientName: "Example AI",
        redirectUris: ["https://example.test/cb"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      const policy = createAgentPolicy("read-only");
      cp.store.insertAgent({
        id: "agt_keep",
        alias: "Keep",
        userId: owner,
        status: "offline",
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      });
      const removedId = cp.store.createOAuthConnection(owner, clientId, now);
      const keptId = cp.store.createOAuthConnection(owner, clientId, now);
      const foreignId = cp.store.createOAuthConnection(other, clientId, now);
      cp.store.setOAuthConnectionDevices(owner, removedId, ["agt_keep"], now);
      cp.store.setOAuthConnectionDevices(owner, keptId, ["agt_keep"], now);
      const credentials = [removedId, keptId, foreignId].map((connectionId, i) => {
        const userId = i === 2 ? other : owner;
        const tokenHash = hashSecret(randomToken(32)),
          codeHash = hashSecret(randomToken(32));
        cp.store.createRefreshToken({
          tokenHash,
          familyId: "family_" + i,
          userId,
          clientId,
          connectionId,
          resource: "http://127.0.0.1:3000/mcp",
          scope: "agents:read",
          expiresAt: future,
          createdAt: now,
        });
        cp.store.insertAuthorizationCode({
          id: "code_" + i,
          codeHash,
          clientId,
          userId,
          connectionId,
          redirectUri: "https://example.test/cb",
          codeChallenge: "synthetic",
          codeChallengeMethod: "S256",
          resource: "http://127.0.0.1:3000/mcp",
          scope: "agents:read",
          expiresAt: future,
          createdAt: now,
        });
        return { tokenHash, codeHash };
      });
      const call = async (
        method: string,
        suffix: string,
        userId?: string,
        origin = "http://127.0.0.1:3000",
      ) => {
        const endpoint = "/api/dashboard/ai-connections/" + suffix;
        const res = captureResponse();
        await cp.handleHttp(
          request(method, endpoint, {
            ...(userId ? { cookie: "ssh_mcp_web_session=" + sessions.get(userId) } : {}),
            origin,
            "x-ssh-mcp-dashboard": "1",
            "sec-fetch-site": "same-origin",
          }),
          res as unknown as ServerResponse,
          endpoint,
        );
        return res;
      };
      expect((await call("DELETE", removedId)).statusCode).toBe(401);
      expect((await call("DELETE", removedId, owner)).statusCode).toBe(409);
      expect((await call("DELETE", removedId, other)).statusCode).toBe(404);
      expect((await call("POST", removedId + "/disconnect", owner)).statusCode).toBe(200);
      await expect(call("DELETE", removedId, owner, "https://evil.example")).rejects.toMatchObject({
        status: 403,
      });
      expect(cp.store.getRefreshTokenByHash(credentials[0]!.tokenHash)?.revokedAt).toBeTruthy();
      const removed = await call("DELETE", removedId, owner);
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toEqual({ removed: true, connectionId: removedId });
      expect(cp.store.getOAuthConnection(owner, removedId)).toBeUndefined();
      expect(cp.store.getRefreshTokenByHash(credentials[0]!.tokenHash)).toBeUndefined();
      expect(cp.store.getAuthorizationCodeByHash(credentials[0]!.codeHash)).toBeUndefined();
      expect(cp.store.listUserOAuthConnections(owner).map((c) => c.id)).toEqual([keptId]);
      expect(cp.store.getOAuthConnection(other, foreignId)?.status).toBe("active");
      for (const credential of credentials.slice(1)) {
        expect(cp.store.getRefreshTokenByHash(credential.tokenHash)?.revokedAt).toBeUndefined();
        expect(cp.store.getAuthorizationCodeByHash(credential.codeHash)).toBeDefined();
      }
      expect(cp.store.getClient(clientId)).toBeDefined();
      expect(cp.store.getAgent("agt_keep")).toBeDefined();
      expect(cp.store.listGrantedDevices(owner, keptId)).toEqual(["agt_keep"]);
      expect(cp.store.isStrictVisibilityEnabled(owner)).toBe(true);
      expect(cp.store.listAudit(owner, undefined, 20).map((e) => e.eventType)).toEqual(
        expect.arrayContaining(["ai_connection_disconnected", "ai_connection_removed"]),
      );
      expect((await call("DELETE", removedId, owner)).statusCode).toBe(404);
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
