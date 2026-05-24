import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, vi, test } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import {
  generateEd25519PemKeyPair,
  nowIso,
  randomToken,
  signEnvelope,
} from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import { capabilitiesFromScopes, parseScopes } from "../../src/remote/scopes.js";
import type {
  ActionRecord,
  ActionResultEnvelope,
  RemotePrincipal,
  RemoteAgentRecord,
  RemoteConfig,
} from "../../src/remote/types.js";
import {
  AGENT_ENROLL_COMMAND,
  AGENT_RUN_COMMAND,
  LEGACY_AGENT_COMMAND_PATTERN,
} from "./helpers.js";

function testConfig(baseDir: string): RemoteConfig {
  const publicBaseUrl = "http://127.0.0.1:3000";
  return {
    enabled: true,
    publicBaseUrl,
    mcpResourceUrl: `${publicBaseUrl}/mcp`,
    databaseUrl: `file:${path.join(baseDir, "remote.db")}`,
    githubCallbackUrl: `${publicBaseUrl}/oauth/callback/github`,
    allowAllUsers: true,
    allowedGitHubLogins: [],
    allowedGitHubIds: [],
    accessTokenTtlSeconds: 900,
    authCodeTtlSeconds: 300,
    enrollmentTokenTtlSeconds: 600,
    controlPlaneSigningKeyPath: path.join(baseDir, "control-plane.json"),
    jwtSigningKeyPath: path.join(baseDir, "jwt.json"),
    agentWsPath: "/api/agents/connect",
    maxActionTimeoutSeconds: 120,
    maxOutputBytes: 200_000,
    maxOAuthClients: 100,
  };
}

describe("remote control plane remote-agent contracts", () => {
  test("generates deterministic agent CLI commands for enrollment", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const principal: RemotePrincipal = {
        tokenId: "tok_test",
        userId: "github:1",
        githubId: "1",
        githubLogin: "tester",
        capabilities: capabilitiesFromScopes(parseScopes("agents:admin")),
        scopes: ["agents:admin"],
      };
      const harness = controlPlane as unknown as {
        createEnrollmentToken(
          principal: RemotePrincipal,
          args: Record<string, unknown>,
        ): Record<string, unknown>;
      };

      const result = harness.createEnrollmentToken(principal, {
        alias: "prod one",
        requested_profile: "operations",
      });

      expect(result.commands).toEqual(
        expect.objectContaining({
          npm: expect.stringContaining(AGENT_ENROLL_COMMAND),
          run: AGENT_RUN_COMMAND,
          windows: expect.stringContaining(AGENT_ENROLL_COMMAND),
        }),
      );
      expect(JSON.stringify(result.commands)).toContain("--alias 'prod one'");
      expect(JSON.stringify(result.commands)).not.toMatch(LEGACY_AGENT_COMMAND_PATTERN);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("generates canonical install commands for existing agents without exposing a stale token", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const policy = createAgentPolicy("operations");
      const now = nowIso();
      const agent: RemoteAgentRecord = {
        id: "agt_install_contract",
        userId: "github:1",
        alias: "prod 'core'",
        status: "online",
        publicKey: generateEd25519PemKeyPair().publicKeyPem,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      const harness = controlPlane as unknown as {
        installCommand(
          agent: RemoteAgentRecord,
          token: string | undefined,
        ): Record<string, unknown>;
      };

      const result = harness.installCommand(agent, undefined);
      const commands = result.commands as Record<string, string>;
      const serialized = JSON.stringify(result);

      expect(result).toEqual(
        expect.objectContaining({
          agent_id: agent.id,
          alias: agent.alias,
          token_recoverable: false,
          commands: expect.objectContaining({
            npm: expect.stringContaining(AGENT_ENROLL_COMMAND),
            run: AGENT_RUN_COMMAND,
            windows: expect.stringContaining(AGENT_ENROLL_COMMAND),
          }),
        }),
      );
      expect(serialized).toContain("<create-a-new-enrollment-token>");
      expect(commands.npm).toContain(`--alias 'prod '"'"'core'"'"''`);
      expect(commands.windows).toContain("--alias 'prod ''core'''");
      expect(serialized).not.toMatch(LEGACY_AGENT_COMMAND_PATTERN);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects an action result nonce that was already seen on the connection", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const keys = generateEd25519PemKeyPair();
      const policy = createAgentPolicy("read-only");
      const now = nowIso();
      const agent: RemoteAgentRecord = {
        id: "agt_replay",
        userId: "github:1",
        alias: "replay",
        status: "online",
        publicKey: keys.publicKeyPem,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      const action: ActionRecord = {
        id: "act_replay",
        userId: agent.userId,
        agentId: agent.id,
        tool: "get_system_status",
        capability: "system.read",
        args: {},
        status: "sent",
        issuedAt: now,
        deadline: new Date(Date.now() + 30_000).toISOString(),
      };
      const replayNonce = randomToken(16);
      const connection = { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() };
      const resolve = vi.fn();
      const reject = vi.fn();
      const timeout = setTimeout(() => undefined, 30_000);
      const harness = controlPlane as unknown as {
        store: {
          insertAgent(agent: RemoteAgentRecord): void;
          listAudit(userId: string, agentId: string | undefined, limit: number): unknown[];
        };
        agentConnections: Map<
          string,
          { agent: RemoteAgentRecord; connection: unknown; seenNonces: Map<string, number> }
        >;
        pendingActions: Map<
          string,
          {
            action: ActionRecord;
            resolve(value: ActionResultEnvelope): void;
            reject(error: Error): void;
            timeout: NodeJS.Timeout;
          }
        >;
        handleActionResult(connection: unknown, result: ActionResultEnvelope): Promise<void>;
      };
      harness.store.insertAgent(agent);
      harness.agentConnections.set(agent.id, {
        agent,
        connection,
        seenNonces: new Map([[replayNonce, Date.now() + 30_000]]),
      });
      harness.pendingActions.set(action.id, { action, resolve, reject, timeout });
      const result: ActionResultEnvelope = {
        type: "action.result",
        action_id: action.id,
        agent_id: agent.id,
        nonce: replayNonce,
        status: "ok",
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        started_at: now,
        finished_at: nowIso(),
        truncated: false,
        signature: "",
      };
      result.signature = signEnvelope(
        result as unknown as Record<string, unknown>,
        keys.privateKeyPem,
      );

      await harness.handleActionResult(connection, result);

      expect(resolve).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ACTION_REPLAY_DETECTED" }),
      );
      expect(JSON.stringify(harness.store.listAudit(agent.userId, undefined, 20))).toContain(
        "agent_result_replay_detected",
      );
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prunes expired action result nonces from live connections", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-control-plane-"));
    const controlPlane = new RemoteControlPlane(testConfig(dir));
    await controlPlane.initialize();
    try {
      const policy = createAgentPolicy("read-only");
      const now = nowIso();
      const agent: RemoteAgentRecord = {
        id: "agt_nonce_prune",
        userId: "github:1",
        alias: "nonce-prune",
        status: "online",
        publicKey: generateEd25519PemKeyPair().publicKeyPem,
        profile: policy.profile,
        policy,
        policyVersion: policy.version,
        createdAt: now,
        updatedAt: now,
      };
      const seenNonces = new Map<string, number>([
        ["expired-nonce", Date.now() - 1],
        ["fresh-nonce", Date.now() + 30_000],
      ]);
      const harness = controlPlane as unknown as {
        agentConnections: Map<
          string,
          { agent: RemoteAgentRecord; connection: unknown; seenNonces: Map<string, number> }
        >;
        cleanupEphemeralState(now?: number): void;
      };

      harness.agentConnections.set(agent.id, {
        agent,
        connection: { sendJson: vi.fn(), close: vi.fn(), onClose: vi.fn() },
        seenNonces,
      });

      harness.cleanupEphemeralState(Date.now());

      expect(seenNonces.has("expired-nonce")).toBe(false);
      expect(seenNonces.has("fresh-nonce")).toBe(true);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
