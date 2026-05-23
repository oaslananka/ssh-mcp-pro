import { describe, expect, test } from "@jest/globals";
import {
  generateEd25519PemKeyPair,
  nowIso,
  randomToken,
  signEnvelope,
} from "../../src/remote/crypto.js";
import { createAgentPolicy } from "../../src/remote/policy.js";
import {
  parseActionRequestEnvelope,
  parseActionResultEnvelope,
  parseAgentHelloEnvelope,
  parseAgentPolicy,
  parsePolicyUpdateEnvelope,
} from "../../src/remote/schemas.js";
import type {
  ActionRequestEnvelope,
  ActionResultEnvelope,
  AgentHelloEnvelope,
  PolicyUpdateEnvelope,
} from "../../src/remote/types.js";

const host = {
  hostname: "test-host",
  os: "Linux",
  arch: "x64",
  platform: "linux",
};

describe("remote protocol schemas", () => {
  test("validates complete agent policy objects", () => {
    const policy = createAgentPolicy("read-only");

    expect(parseAgentPolicy(policy).profile).toBe("read-only");
    expect(() => parseAgentPolicy({ ...policy, maxOutputBytes: -1 })).toThrow();
  });

  test("validates signed agent hello envelope shape", () => {
    const keys = generateEd25519PemKeyPair();
    const hello: AgentHelloEnvelope = {
      type: "agent.hello",
      agent_id: "agt_test",
      timestamp: nowIso(),
      nonce: randomToken(16),
      capabilities: ["system.read"],
      agent_version: "test",
      host,
      signature: "",
    };
    hello.signature = signEnvelope(hello as unknown as Record<string, unknown>, keys.privateKeyPem);

    expect(parseAgentHelloEnvelope(hello).agent_id).toBe("agt_test");
    expect(() => parseAgentHelloEnvelope({ ...hello, capabilities: ["root.all"] })).toThrow();
  });

  test("validates action request, action result, and policy update envelopes", () => {
    const action: ActionRequestEnvelope = {
      type: "action.request",
      action_id: "act_test",
      agent_id: "agt_test",
      user_id: "github:1",
      tool: "get_system_status",
      capability: "system.read",
      args: {},
      policy_version: 1,
      issued_at: nowIso(),
      deadline: new Date(Date.now() + 30_000).toISOString(),
      nonce: randomToken(16),
      signature: "sig",
    };
    const result: ActionResultEnvelope = {
      type: "action.result",
      action_id: "act_test",
      agent_id: "agt_test",
      nonce: randomToken(16),
      status: "ok",
      exit_code: 0,
      stdout: "ok",
      stderr: "",
      started_at: nowIso(),
      finished_at: nowIso(),
      truncated: false,
      signature: "sig",
    };
    const update: PolicyUpdateEnvelope = {
      type: "policy.update",
      agent_id: "agt_test",
      policy: createAgentPolicy("operations"),
      policy_version: 2,
      issued_at: nowIso(),
      nonce: randomToken(16),
      signature: "sig",
    };

    expect(parseActionRequestEnvelope(action).tool).toBe("get_system_status");
    expect(parseActionResultEnvelope(result).status).toBe("ok");
    expect(parsePolicyUpdateEnvelope(update).policy.profile).toBe("operations");
    expect(() => parseActionRequestEnvelope({ ...action, tool: "ssh_open_session" })).toThrow();
    expect(() => parseActionResultEnvelope({ ...result, error_code: "BAD_CODE" })).toThrow();
  });
});
