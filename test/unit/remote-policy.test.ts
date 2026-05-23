import { describe, expect, test } from "@jest/globals";
import {
  createAgentPolicy,
  isContainerAllowed,
  isPathAllowed,
  isServiceAllowed,
  mergeCustomPolicy,
} from "../../src/remote/policy.js";

describe("remote agent policy", () => {
  test("read-only profile exposes read capabilities without mutation capabilities", () => {
    const policy = createAgentPolicy("read-only");

    expect(policy.capabilities["hosts.read"]).toBe(true);
    expect(policy.capabilities["system.read"]).toBe(true);
    expect(policy.capabilities["shell.exec"]).toBe(false);
    expect(policy.capabilities["sudo.exec"]).toBe(false);
  });

  test("full-admin profile enables explicit admin capabilities", () => {
    const policy = createAgentPolicy("full-admin");

    expect(policy.capabilities["shell.exec"]).toBe(true);
    expect(policy.capabilities["sudo.exec"]).toBe(true);
    expect(policy.capabilities["agent.admin"]).toBe(true);
    expect(isServiceAllowed(policy, "sshd")).toBe(true);
    expect(isContainerAllowed(policy, "app")).toBe(true);
  });

  test("denies root and system prefixes while preserving scoped writable paths", () => {
    const policy = createAgentPolicy("operations");

    expect(isPathAllowed(policy, "/")).toBe(false);
    expect(isPathAllowed(policy, "/etc/passwd")).toBe(false);
    expect(isPathAllowed(policy, "/tmp/../etc/passwd")).toBe(false);
    expect(isPathAllowed(policy, "/tmp/agent.log")).toBe(true);
    expect(isPathAllowed(policy, "/tmp/./agent.log")).toBe(true);
    expect(isPathAllowed(policy, "/var/tmp/agent.log")).toBe(true);
    expect(isPathAllowed(policy, "/home/user/.ssh/id_ed25519")).toBe(false);
  });

  test("custom policy merges explicit capability and path overrides", () => {
    const policy = mergeCustomPolicy({
      capabilities: { "files.write": true },
      allowPaths: ["/srv/app"],
      denyPaths: ["/srv/app/private"],
    });

    expect(policy.capabilities["files.write"]).toBe(true);
    expect(isPathAllowed(policy, "/srv/app/config.json")).toBe(true);
    expect(isPathAllowed(policy, "/srv/app/private/key")).toBe(false);
  });

  test("operations profile denies service and container mutation until allowlisted", () => {
    const policy = createAgentPolicy("operations");

    expect(isServiceAllowed(policy, "sshd")).toBe(false);
    expect(isContainerAllowed(policy, "web")).toBe(false);

    const scoped = mergeCustomPolicy({
      profile: "operations",
      allowServices: ["sshd"],
      allowContainers: ["web"],
    });

    expect(isServiceAllowed(scoped, "sshd")).toBe(true);
    expect(isServiceAllowed(scoped, "postgresql")).toBe(false);
    expect(isContainerAllowed(scoped, "web")).toBe(true);
    expect(isContainerAllowed(scoped, "db")).toBe(false);
  });
});
