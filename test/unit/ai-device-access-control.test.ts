import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { issueAccessToken, loadJwtKeyPair } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import type { RemotePrincipal } from "../../src/remote/types.js";
import { request, testConfig } from "../helpers/web-dashboard-fixture.js";

describe("remote device access isolation between AI connections", () => {
  test("filters inventory and rejects direct commands without affecting other clients", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-ai-device-isolation-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    const now = new Date().toISOString();
    const policy = createAgentPolicy("read-only");
    try {
      cp.store.upsertUser({ internalId: "github:1", id: "1", login: "alice", now });
      cp.store.upsertUser({ internalId: "github:2", id: "2", login: "bob", now });
      for (const clientId of ["cli_a", "cli_b"]) {
        cp.store.insertClient({
          id: "row_" + clientId,
          clientId,
          clientName: clientId,
          redirectUris: ["https://example.test/callback"],
          grantTypes: ["authorization_code", "refresh_token"],
          responseTypes: ["code"],
          tokenEndpointAuthMethod: "none",
          createdAt: now,
        });
      }
      for (const [id, alias, userId] of [
        ["agt_pc", "workstation", "github:1"],
        ["agt_vps", "server", "github:1"],
        ["agt_new", "new-laptop", "github:1"],
        ["agt_other", "foreign", "github:2"],
      ]) {
        cp.store.insertAgent({
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
      const connectionA = cp.store.createOAuthConnection("github:1", "cli_a", now);
      const connectionB = cp.store.createOAuthConnection("github:1", "cli_b", now);
      const keys = await loadJwtKeyPair(cp.config.jwtSigningKeyPath);
      const creds = { id: "github:1", githubId: "1", githubLogin: "alice" };
      const scopes = ["agents:read", "hosts:read", "status:read"] as const;
      const tokenA = await issueAccessToken(cp.config, keys, creds, [...scopes], {
        clientId: "cli_a",
        connectionId: connectionA,
      });
      const tokenB = await issueAccessToken(cp.config, keys, creds, [...scopes], {
        clientId: "cli_b",
        connectionId: connectionB,
      });
      const tokenLegacy = await issueAccessToken(cp.config, keys, creds, [...scopes]);
      const internal = cp as unknown as {
        authenticate(req: IncomingMessage): Promise<RemotePrincipal>;
        callRemoteTool(
          principal: RemotePrincipal,
          tool: string,
          args: Record<string, unknown>,
        ): Promise<unknown>;
      };
      const auth = (token: string) =>
        internal.authenticate(request("GET", "/api/agents", { authorization: "Bearer " + token }));
      const principalA = await auth(tokenA.token);
      const principalB = await auth(tokenB.token);
      expect(await internal.callRemoteTool(principalA, "list_agents", {})).toEqual({ agents: [] });
      expect(await internal.callRemoteTool(principalB, "list_hosts", {})).toEqual({ hosts: [] });
      expect((await auth(tokenLegacy.token)).connectionId).toBeUndefined();

      cp.store.setOAuthConnectionDevices("github:1", connectionA, ["agt_pc"], now);
      cp.store.setOAuthConnectionDevices("github:1", connectionB, ["agt_vps"], now);
      await expect(auth(tokenLegacy.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const a = (await internal.callRemoteTool(principalA, "list_hosts", {})) as {
        hosts: Array<{ alias: string }>;
      };
      const b = (await internal.callRemoteTool(principalB, "list_agents", {})) as {
        agents: Array<{ alias: string }>;
      };
      expect(a.hosts.map((v) => v.alias)).toEqual(["workstation"]);
      expect(b.agents.map((v) => v.alias)).toEqual(["server"]);
      for (const selector of ["agt_vps", "server", "agt_other"]) {
        await expect(
          internal.callRemoteTool(principalA, "get_system_status", {
            agent_id_or_alias: selector,
          }),
        ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
      }

      cp.store.setOAuthConnectionDevices("github:1", connectionA, [], now);
      expect(await internal.callRemoteTool(principalA, "list_agents", {})).toEqual({ agents: [] });
      expect(
        ((await internal.callRemoteTool(principalB, "list_hosts", {})) as { hosts: unknown[] })
          .hosts,
      ).toHaveLength(1);
      cp.store.revokeOAuthConnection("github:1", connectionB, now);
      await expect(auth(tokenB.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await internal.callRemoteTool(principalB, "list_agents", {})).toEqual({ agents: [] });
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
