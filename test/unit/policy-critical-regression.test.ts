import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { DEFAULT_CONFIG } from "../../src/config.js";
import { validateHttpStartupConfig } from "../../src/http-security.js";
import { PolicyEngine } from "../../src/policy.js";
import { createAgentPolicy, isPathAllowed } from "../../src/remote/policy.js";
import { checkCommandSafety } from "../../src/safety.js";

const policyEngine = () => new PolicyEngine(DEFAULT_CONFIG.policy);

describe("policy critical-path regression fixtures", () => {
  test("denies root login, raw sudo, and destructive commands by default", () => {
    const policy = policyEngine();

    expect(policy.check({ action: "ssh.open", host: "prod", username: "root" })).toMatchObject({
      allowed: false,
    });
    expect(
      policy.check({ action: "proc.sudo", host: "prod", command: "id", rawSudo: true }),
    ).toMatchObject({
      allowed: false,
    });
    expect(policy.check({ action: "proc.exec", host: "prod", command: "rm -rf /" })).toMatchObject({
      allowed: false,
      riskLevel: "critical",
    });
    expect(checkCommandSafety("rm -rf /")).toMatchObject({
      safe: false,
      riskLevel: "critical",
    });
  });

  test("requires strict host-key verification for non-loopback HTTP", () => {
    const startup = {
      host: "0.0.0.0",
      allowedOrigins: ["https://chat.openai.com"],
      publicUrl: "https://ssh-mcp.example/mcp",
    };
    const secureContext = {
      toolProfile: "remote-safe" as const,
      allowedHosts: ["prod"],
      hostKeyPolicy: "strict" as const,
      authMode: "bearer" as const,
      oauthConfigured: false,
    };

    expect(() =>
      validateHttpStartupConfig(startup, "opaque-test-value", secureContext),
    ).not.toThrow();
    expect(() =>
      validateHttpStartupConfig(startup, "opaque-test-value", {
        ...secureContext,
        hostKeyPolicy: "insecure",
      }),
    ).toThrow(/strict SSH host-key verification/u);
  });

  test("denies public tunnel binds and local or remote path policy escapes", () => {
    const policy = policyEngine();

    expect(
      policy.check({
        action: "tunnel.local",
        host: "prod",
        localBindHost: "0.0.0.0",
        remoteHost: "127.0.0.1",
        remotePort: 22,
      }),
    ).toMatchObject({ allowed: false });
    expect(
      policy.check({
        action: "transfer.local.read",
        host: "prod",
        path: path.join(os.tmpdir(), "ssh-mcp-pro-fixture.txt"),
      }),
    ).toMatchObject({ allowed: true });
    expect(
      policy.check({ action: "transfer.local.read", host: "prod", path: "/etc/shadow" }),
    ).toMatchObject({
      allowed: false,
    });
    expect(policy.check({ action: "fs.read", host: "prod", path: "/etc/shadow" })).toMatchObject({
      allowed: false,
    });
  });

  test("keeps remote read-only policy from writing root or system paths", () => {
    const policy = createAgentPolicy("read-only");

    expect(policy.capabilities["fs.write"]).not.toBe(true);
    expect(isPathAllowed(policy, "/tmp/ssh-mcp-pro.txt")).toBe(true);
    expect(isPathAllowed(policy, "/etc/shadow")).toBe(false);
    expect(isPathAllowed(policy, "/")).toBe(false);
  });
});
