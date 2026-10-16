import { generateKeyPairSync } from "node:crypto";
import { bench, describe } from "vitest";
import { canonicalJson, signEnvelope, verifyEnvelope } from "../../src/remote/crypto.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const envelope: Record<string, unknown> = {
  type: "command.request",
  id: "req_0123456789abcdef",
  agentId: "agent_fedcba9876543210",
  issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:05:00.000Z",
  nonce: "b64url-nonce-value-for-replay-protection",
  payload: {
    tool: "proc_exec",
    command: "systemctl status nginx --no-pager",
    cwd: "/srv/app/current",
    env: { NODE_ENV: "production", LOG_LEVEL: "info", REGION: "eu-west-1" },
    timeoutMs: 30_000,
    tags: ["ops", "read-only", "nginx"],
    policy: {
      profile: "operations",
      allowedPaths: ["/srv/app", "/var/log"],
      allowedServices: ["nginx", "postgresql"],
      deniedCommands: ["rm -rf", "shutdown", "reboot"],
    },
  },
};

const signedEnvelope = { ...envelope, signature: signEnvelope(envelope, privateKey) };

describe("remote envelope crypto", () => {
  bench("canonicalJson", () => {
    canonicalJson(envelope);
  });

  bench("verifyEnvelope", () => {
    verifyEnvelope(signedEnvelope, publicKey);
  });
});
