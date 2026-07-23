import { describe, expect, test } from "vitest";
import { createAgentPolicy } from "../../src/remote/policy.js";
import {
  MAX_POLICY_UPDATE_NONCES,
  POLICY_UPDATE_MAX_AGE_MS,
  POLICY_UPDATE_MAX_FUTURE_SKEW_MS,
  rememberAcceptedPolicyUpdate,
  validatePolicyUpdate,
} from "../../src/remote/policy-update-guard.js";
import type { AgentPolicy, PolicyUpdateEnvelope } from "../../src/remote/types.js";

const NOW = Date.UTC(2026, 6, 23, 1, 0, 0);

function update(
  policy: AgentPolicy,
  overrides: Partial<PolicyUpdateEnvelope> = {},
): PolicyUpdateEnvelope {
  return {
    type: "policy.update",
    agent_id: "agt_policy_guard",
    policy,
    policy_version: policy.version,
    issued_at: new Date(NOW).toISOString(),
    nonce: `nonce-policy-${policy.version}-0000000000`,
    signature: "signed",
    ...overrides,
  };
}

describe("policy update replay and downgrade guard", () => {
  test("accepts a fresh matching version that is newer than the current policy", () => {
    const policy = { ...createAgentPolicy("operations"), version: 2 };

    expect(validatePolicyUpdate(update(policy), 1, new Map(), NOW)).toEqual({ accepted: true });
  });

  test("rejects replay, stale, future, mismatched, equal, and older updates deterministically", () => {
    const seenNonces = new Map<string, number>();
    const policy = { ...createAgentPolicy("operations"), version: 2 };
    const accepted = update(policy);
    rememberAcceptedPolicyUpdate(seenNonces, accepted.nonce, NOW);

    expect(validatePolicyUpdate(accepted, 1, seenNonces, NOW)).toEqual({
      accepted: false,
      reason: "replay",
    });
    expect(
      validatePolicyUpdate(
        update(policy, {
          nonce: "nonce-policy-stale-000000",
          issued_at: new Date(NOW - POLICY_UPDATE_MAX_AGE_MS - 1).toISOString(),
        }),
        1,
        seenNonces,
        NOW,
      ),
    ).toEqual({ accepted: false, reason: "stale" });
    expect(
      validatePolicyUpdate(
        update(policy, {
          nonce: "nonce-policy-future-00000",
          issued_at: new Date(NOW + POLICY_UPDATE_MAX_FUTURE_SKEW_MS + 1).toISOString(),
        }),
        1,
        seenNonces,
        NOW,
      ),
    ).toEqual({ accepted: false, reason: "future" });
    expect(
      validatePolicyUpdate(
        update(
          { ...policy, version: 3 },
          {
            policy_version: 2,
            nonce: "nonce-policy-mismatch-000",
          },
        ),
        1,
        seenNonces,
        NOW,
      ),
    ).toEqual({ accepted: false, reason: "version_mismatch" });
    expect(
      validatePolicyUpdate(
        update(policy, { nonce: "nonce-policy-equal-000000" }),
        2,
        seenNonces,
        NOW,
      ),
    ).toEqual({ accepted: false, reason: "not_newer" });
    expect(
      validatePolicyUpdate(
        update({ ...policy, version: 1 }, { nonce: "nonce-policy-older-000000" }),
        2,
        seenNonces,
        NOW,
      ),
    ).toEqual({ accepted: false, reason: "not_newer" });
  });

  test("keeps accepted nonce storage bounded and prunes expired entries", () => {
    const seenNonces = new Map<string, number>();
    for (let index = 0; index < MAX_POLICY_UPDATE_NONCES + 50; index += 1) {
      rememberAcceptedPolicyUpdate(
        seenNonces,
        `nonce-policy-bounded-${String(index).padStart(5, "0")}`,
        NOW,
      );
    }

    expect(seenNonces.size).toBe(MAX_POLICY_UPDATE_NONCES);
    expect(seenNonces.has("nonce-policy-bounded-00000")).toBe(false);
    expect(
      seenNonces.has(
        `nonce-policy-bounded-${String(MAX_POLICY_UPDATE_NONCES + 49).padStart(5, "0")}`,
      ),
    ).toBe(true);

    const nextPolicy = { ...createAgentPolicy("full-admin"), version: 3 };
    expect(
      validatePolicyUpdate(
        update(nextPolicy, {
          nonce: "nonce-policy-after-expiry-0",
          issued_at: new Date(NOW + POLICY_UPDATE_MAX_AGE_MS + 1).toISOString(),
        }),
        2,
        seenNonces,
        NOW + POLICY_UPDATE_MAX_AGE_MS + 1,
      ),
    ).toEqual({ accepted: true });
    expect(seenNonces.size).toBe(0);
  });
});
