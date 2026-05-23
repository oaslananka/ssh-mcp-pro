import { describe, expect, test } from "@jest/globals";
import { AuditLog } from "../../src/audit.js";
import type { PolicyDecision } from "../../src/policy.js";

describe("AuditLog", () => {
  test("records redacted audit events and returns immutable snapshots", () => {
    const audit = new AuditLog();

    const recorded = audit.record({
      action: "proc.sudo",
      sessionId: "session-1",
      target: "password=secret",
      allowed: false,
      reason: "token=abc123",
    });

    const [listed] = audit.list();
    expect(recorded.target).toBe("****");
    expect(recorded.reason).toBe("****");
    expect(listed).toEqual(
      expect.objectContaining({
        action: "proc.sudo",
        allowed: false,
        target: "****",
        reason: "****",
      }),
    );

    if (listed) {
      listed.action = "mutated";
    }

    expect(audit.list()[0]?.action).toBe("proc.sudo");
  });

  test("trims old audit events when max size is exceeded", () => {
    const audit = new AuditLog(2);

    audit.record({ action: "one", allowed: true });
    audit.record({ action: "two", allowed: true });
    audit.record({ action: "three", allowed: true });

    expect(audit.list()).toEqual([
      expect.objectContaining({ action: "two" }),
      expect.objectContaining({ action: "three" }),
    ]);
  });

  test("records policy decisions with and without reasons", () => {
    const audit = new AuditLog();
    const denied: PolicyDecision = {
      allowed: false,
      mode: "enforce",
      action: "fs.remove",
      reason: "blocked by policy",
    };
    const allowed: PolicyDecision = {
      allowed: true,
      mode: "enforce",
      action: "proc.exec",
    };

    audit.recordPolicyDecision(denied, {
      action: "fs.remove",
      sessionId: "session-1",
      target: "/etc/shadow",
    });
    audit.recordPolicyDecision(allowed, {
      action: "proc.exec",
      sessionId: "session-1",
      target: "uptime",
    });

    expect(audit.list()).toEqual([
      expect.objectContaining({
        action: "fs.remove",
        allowed: false,
        reason: "blocked by policy",
      }),
      expect.objectContaining({
        action: "proc.exec",
        allowed: true,
      }),
    ]);
    expect(audit.list()[1]).not.toHaveProperty("reason");
  });
});
