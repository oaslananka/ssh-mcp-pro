import { AGENT_NONCE_TTL_MS, hasSeenNonce, rememberNonce } from "./http-util.js";
import type { PolicyUpdateEnvelope } from "./types.js";

export const POLICY_UPDATE_MAX_AGE_MS = AGENT_NONCE_TTL_MS;
export const POLICY_UPDATE_MAX_FUTURE_SKEW_MS = 30_000;
export { MAX_AGENT_CONNECTION_NONCES as MAX_POLICY_UPDATE_NONCES } from "./http-util.js";

export type PolicyUpdateRejectionReason =
  | "replay"
  | "stale"
  | "future"
  | "version_mismatch"
  | "not_newer";

export type PolicyUpdateValidation =
  | { accepted: true }
  | { accepted: false; reason: PolicyUpdateRejectionReason };

export function validatePolicyUpdate(
  update: PolicyUpdateEnvelope,
  currentPolicyVersion: number,
  seenNonces: Map<string, number>,
  now = Date.now(),
): PolicyUpdateValidation {
  if (hasSeenNonce(seenNonces, update.nonce, now)) {
    return { accepted: false, reason: "replay" };
  }

  const issuedAt = Date.parse(update.issued_at);
  if (!Number.isFinite(issuedAt) || now - issuedAt > POLICY_UPDATE_MAX_AGE_MS) {
    return { accepted: false, reason: "stale" };
  }
  if (issuedAt - now > POLICY_UPDATE_MAX_FUTURE_SKEW_MS) {
    return { accepted: false, reason: "future" };
  }
  if (update.policy_version !== update.policy.version) {
    return { accepted: false, reason: "version_mismatch" };
  }
  if (update.policy_version <= currentPolicyVersion) {
    return { accepted: false, reason: "not_newer" };
  }
  return { accepted: true };
}

export function rememberAcceptedPolicyUpdate(
  seenNonces: Map<string, number>,
  nonce: string,
  now = Date.now(),
): void {
  rememberNonce(seenNonces, nonce, now);
}
