import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { AgentConnection, PendingAction } from "../../src/remote/agent-handler.js";
import type { WebSocketConnection } from "../../src/remote/websocket.js";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import {
  captureResponse,
  jsonRequest,
  request,
  testConfig,
} from "../helpers/web-dashboard-fixture.js";

describe("dashboard account-owned AI connection controls", () => {
  test("saves a selected device, blocks cross-account writes, validates Origin and disconnects", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-ai-dashboard-access-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const policy = createAgentPolicy("read-only");
    try {
      const sessions: Record<string, string> = {};
      for (const [userId, login] of [
        ["github:1", "alice"],
        ["github:2", "bob"],
      ]) {
        cp.store.upsertUser({ internalId: userId, id: userId.split(":")[1]!, login, now });
        const cookie = randomToken(32);
        cp.store.createDashboardSession(hashSecret(cookie), userId, future, now);
        sessions[userId] = cookie;
      }
      cp.store.insertClient({
        id: "row_x",
        clientId: "cli_x",
        clientName: "Example AI",
        redirectUris: ["https://example.test/cb?secret=hidden"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: now,
      });
      cp.store.insertAgent({
        id: "agt_own",
        alias: "PC",
        userId: "github:1",
        status: "offline",
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      });
      const connectionId = cp.store.createOAuthConnection("github:1", "cli_x", now);
      const endpoint = "/api/dashboard/ai-connections/" + connectionId + "/devices";
      const headers = (userId: string) => ({
        cookie: "ssh_mcp_web_session=" + sessions[userId],
        origin: "http://127.0.0.1:3000",
        "x-ssh-mcp-dashboard": "1",
        "sec-fetch-site": "same-origin",
      });
      const save = async (userId: string, deviceIds: unknown[], fullHeaders = headers(userId)) => {
        const res = captureResponse();
        await cp.handleHttp(
          jsonRequest("PUT", endpoint, { deviceIds }, fullHeaders),
          res as unknown as ServerResponse,
          endpoint,
        );
        return res;
      };
      const forbiddenHeaders = { ...headers("github:1"), origin: "https://evil.example" };
      await expect(save("github:1", ["agt_own"], forbiddenHeaders)).rejects.toMatchObject({
        status: 403,
      });
      expect((await save("github:2", [])).statusCode).toBe(404);
      expect(cp.store.isStrictVisibilityEnabled("github:1")).toBe(false);
      await expect(save("github:1", ["agt_unknown"])).rejects.toMatchObject({ status: 400 });
      expect(cp.store.isStrictVisibilityEnabled("github:1")).toBe(false);
      const success = await save("github:1", ["agt_own"]);
      expect(success.statusCode).toBe(200);
      expect(JSON.parse(success.body).deviceIds).toEqual(["agt_own"]);

      const api = "/api/dashboard/ai-clients";
      const list = captureResponse();
      await cp.handleHttp(
        request("GET", api, headers("github:1")),
        list as unknown as ServerResponse,
        api,
      );
      const body = JSON.parse(list.body);
      expect(body.strictVisibility).toBe(true);
      expect(body.connections).toEqual([
        expect.objectContaining({
          id: connectionId,
          clientName: "Example AI",
          deviceIds: ["agt_own"],
          redirectHosts: ["example.test"],
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain("secret=hidden");
      const other = captureResponse();
      await cp.handleHttp(
        request("GET", api, headers("github:2")),
        other as unknown as ServerResponse,
        api,
      );
      expect(JSON.parse(other.body).connections).toEqual([]);

      // The browser must only remove the exact immutable ID, never a matching alias.
      const aliasPath = "/api/dashboard/devices/PC";
      const aliasRemoval = captureResponse();
      await cp.handleHttp(
        request("DELETE", aliasPath, headers("github:1")),
        aliasRemoval as unknown as ServerResponse,
        aliasPath,
      );
      expect(aliasRemoval.statusCode).toBe(404);
      expect(cp.store.getAgent("agt_own")).toBeDefined();

      // Model an authenticated socket whose close event arrives after the database row is gone.
      const liveAgent = { ...cp.store.getAgent("agt_own")!, status: "online" as const };
      cp.store.updateAgent(liveAgent);
      const close = vi.fn();
      const connection = { close } as unknown as WebSocketConnection;
      const reject = vi.fn();
      const timeout = setTimeout(() => undefined, 30_000);
      timeout.unref();
      const live = cp as unknown as {
        agentConnections: Map<string, AgentConnection>;
        pendingActions: Map<string, PendingAction>;
      };
      live.agentConnections.set(liveAgent.id, {
        agent: liveAgent,
        connection,
        seenNonces: new Map(),
      });
      live.pendingActions.set("act_pending", {
        action: {
          id: "act_pending",
          userId: liveAgent.userId,
          agentId: liveAgent.id,
          tool: "get_system_status",
          capability: "system.read",
          args: {},
          status: "sent",
          issuedAt: now,
          deadline: future,
        },
        connection,
        resolve: vi.fn(),
        reject,
        timeout,
      });

      // Direct removal (without an earlier revoke click) also drops scoped AI grants.
      const removePath = "/api/dashboard/devices/agt_own";
      const removed = captureResponse();
      await cp.handleHttp(
        request("DELETE", removePath, headers("github:1")),
        removed as unknown as ServerResponse,
        removePath,
      );
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toEqual({ removed: true, agent_id: "agt_own" });
      expect(cp.store.getAgent("agt_own")).toBeUndefined();
      clearTimeout(timeout);
      expect(close).toHaveBeenCalledOnce();
      expect(live.agentConnections.has(liveAgent.id)).toBe(false);
      expect(live.pendingActions.has("act_pending")).toBe(false);
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACTION_OUTCOME_UNKNOWN" }),
      );
      expect(cp.store.listGrantedDevices("github:1", connectionId)).toEqual([]);
      expect(cp.store.getOAuthConnection("github:1", connectionId)?.status).toBe("active");
      expect(cp.store.listAudit("github:1", undefined, 20).map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["agent_revoked", "agent_removed"]),
      );

      const disconnectPath = "/api/dashboard/ai-connections/" + connectionId + "/disconnect";
      const disconnected = captureResponse();
      await cp.handleHttp(
        request("POST", disconnectPath, headers("github:1")),
        disconnected as unknown as ServerResponse,
        disconnectPath,
      );
      expect(disconnected.statusCode).toBe(200);
      expect(cp.store.getOAuthConnection("github:1", connectionId)?.status).toBe("revoked");
      expect(cp.store.listGrantedDevices("github:1", connectionId)).toEqual([]);
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
