import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, vi, test } from "vitest";
import { PolicyEngine, type PolicyConfig } from "../../src/policy.js";

function policy(overrides: Partial<PolicyConfig> = {}) {
  return new PolicyEngine({
    mode: "enforce",
    allowRootLogin: false,
    allowRawSudo: false,
    allowDestructiveCommands: false,
    allowDestructiveFs: false,
    allowedHosts: [],
    commandAllow: [],
    commandDeny: [],
    pathAllowPrefixes: ["/tmp"],
    pathDenyPrefixes: ["/etc/shadow"],
    localPathAllowPrefixes: ["/tmp"],
    localPathDenyPrefixes: [],
    tunnelAllowBindHosts: ["127.0.0.1", "localhost"],
    tunnelDenyBindHosts: ["0.0.0.0"],
    tunnelAllowRemoteHosts: [],
    tunnelDenyRemoteHosts: [],
    tunnelAllowPorts: [],
    tunnelDenyPorts: [],
    ...overrides,
  });
}

describe("PolicyEngine", () => {
  test("denies root login and raw sudo by default", () => {
    const engine = policy();

    expect(() =>
      engine.assertAllowed({
        action: "ssh.open",
        host: "example.com",
        username: "root",
      }),
    ).toThrow("Root SSH login is disabled by policy");

    expect(() =>
      engine.assertAllowed({
        action: "proc.sudo",
        command: "id",
        rawSudo: true,
      }),
    ).toThrow("Raw sudo command execution is disabled by policy");
  });

  test("enforces host, command, and path allow/deny controls", () => {
    const engine = policy({
      allowedHosts: ["^prod-[0-9]+\\.example\\.com$"],
      commandDeny: ["shutdown"],
    });

    expect(() =>
      engine.assertAllowed({
        action: "ssh.open",
        host: "dev.example.com",
        username: "deploy",
      }),
    ).toThrow("not allowed by policy");

    expect(() =>
      engine.assertAllowed({
        action: "proc.exec",
        command: "sudo shutdown -h now",
      }),
    ).toThrow("Command matched commandDeny policy");

    expect(() =>
      engine.assertAllowed({
        action: "fs.remove",
        path: "/etc/shadow",
        destructive: true,
      }),
    ).toThrow("denied by policy");
  });

  test("allows destructive filesystem operations only under allowed prefixes", () => {
    const engine = policy();

    expect(
      engine.assertAllowed({
        action: "fs.remove",
        path: "/tmp/build-cache",
        destructive: true,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
      }),
    );

    expect(() =>
      engine.assertAllowed({
        action: "fs.remove",
        path: "/opt/app",
        destructive: true,
      }),
    ).toThrow("outside allowed prefixes");
  });

  test("canonicalizes deny prefixes before segment-boundary checks", () => {
    const engine = policy({
      pathDenyPrefixes: ["/var/../etc/"],
    });

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "/etc/passwd",
      }),
    ).toThrow("denied by policy");

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "/etc",
      }),
    ).toThrow("denied by policy");

    expect(
      engine.assertAllowed({
        action: "fs.read",
        path: "/etc2/passwd",
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "/var/../etc/passwd",
      }),
    ).toThrow("denied by policy");

    expect(
      engine.assertAllowed({
        action: "fs.read",
        path: "/etc/../home/user/file",
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "//etc///passwd",
      }),
    ).toThrow("denied by policy");

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "./etc/passwd",
      }),
    ).toThrow("denied by policy");

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "/tmp/a\0b",
      }),
    ).toThrow("NUL");

    expect(
      engine.assertAllowed({
        action: "fs.read",
        path: "/tmp/allowed",
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));
  });

  test("normalizes remote Windows separators before path policy checks", () => {
    const engine = policy({
      pathAllowPrefixes: ["/C:/tmp"],
      pathDenyPrefixes: ["/etc/shadow", "/var/tmp/private"],
    });

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "\\etc\\shadow",
      }),
    ).toThrow("denied by policy");

    expect(() =>
      engine.assertAllowed({
        action: "fs.read",
        path: "var\\tmp\\private\\file",
      }),
    ).toThrow("denied by policy");

    expect(
      engine.assertAllowed({
        action: "fs.remove",
        path: "C:\\tmp\\cache",
        destructive: true,
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));

    expect(() =>
      engine.assertAllowed({
        action: "fs.remove",
        path: "C:\\Windows\\System32",
        destructive: true,
      }),
    ).toThrow("outside allowed prefixes");
  });

  test("enforces local transfer prefixes separately from remote path policy", () => {
    const engine = policy({
      localPathAllowPrefixes: ["/tmp/allowed"],
      localPathDenyPrefixes: ["/tmp/allowed/blocked"],
      pathAllowPrefixes: ["/remote"],
      pathDenyPrefixes: ["/remote/secret"],
    });

    expect(
      engine.assertAllowed({
        action: "transfer.local.read",
        path: "/tmp/allowed/file.txt",
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));

    expect(() =>
      engine.assertAllowed({
        action: "transfer.local.read",
        path: "/tmp/allowed2/file.txt",
      }),
    ).toThrow("outside allowed prefixes");

    expect(() =>
      engine.assertAllowed({
        action: "transfer.local.write",
        path: "/tmp/allowed/blocked/file.txt",
      }),
    ).toThrow("denied by policy");
  });

  test("resolves local transfer symlinks before allow and deny prefix checks", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-policy-"));

    try {
      const allowedDir = path.join(rootDir, "allowed");
      const outsideDir = path.join(rootDir, "outside");
      const linkPath = path.join(allowedDir, "linked-outside");
      fs.mkdirSync(allowedDir);
      fs.mkdirSync(outsideDir);
      fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
      fs.symlinkSync(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");

      const engine = policy({
        localPathAllowPrefixes: [allowedDir],
        localPathDenyPrefixes: [outsideDir],
      });

      expect(() =>
        engine.assertAllowed({
          action: "transfer.local.read",
          path: path.join(linkPath, "secret.txt"),
        }),
      ).toThrow("denied by policy");

      expect(() =>
        engine.assertAllowed({
          action: "transfer.local.write",
          path: path.join(linkPath, "new-file.txt"),
        }),
      ).toThrow("denied by policy");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("enforces dedicated tunnel host and port policy", () => {
    const engine = policy({
      tunnelAllowBindHosts: ["127.0.0.1"],
      tunnelDenyBindHosts: ["0.0.0.0"],
      tunnelAllowRemoteHosts: ["^db-[0-9]+\\.internal$"],
      tunnelDenyRemoteHosts: ["metadata.internal"],
      tunnelAllowPorts: ["1024-65535"],
      tunnelDenyPorts: ["2375", "2376"],
    });

    expect(
      engine.assertAllowed({
        action: "tunnel.local",
        host: "ssh-gateway",
        localBindHost: "127.0.0.1",
        localPort: 15432,
        remoteHost: "db-1.internal",
        remotePort: 5432,
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));

    expect(() =>
      engine.assertAllowed({
        action: "tunnel.local",
        localBindHost: "0.0.0.0",
        localPort: 15432,
        remoteHost: "db-1.internal",
        remotePort: 5432,
      }),
    ).toThrow("bind host 0.0.0.0 is denied");

    expect(() =>
      engine.assertAllowed({
        action: "tunnel.local",
        localBindHost: "127.0.0.1",
        localPort: 15432,
        remoteHost: "metadata.internal",
        remotePort: 5432,
      }),
    ).toThrow("remote host metadata.internal is denied");

    expect(() =>
      engine.assertAllowed({
        action: "tunnel.local",
        localBindHost: "127.0.0.1",
        localPort: 80,
        remoteHost: "db-1.internal",
        remotePort: 5432,
      }),
    ).toThrow("port 80 is outside allowed policy");

    expect(() =>
      engine.assertAllowed({
        action: "tunnel.local",
        localBindHost: "127.0.0.1",
        localPort: 15432,
        remoteHost: "db-1.internal",
        remotePort: 2375,
      }),
    ).toThrow("port 2375 is denied");
  });

  test("covers allow-list, unsafe-command, and secondary path decisions", () => {
    const engine = policy({
      allowRootLogin: true,
      allowRawSudo: true,
      allowDestructiveCommands: true,
      commandAllow: ["^systemctl status", "whoami", "^rm -rf /tmp/cache$"],
      commandDeny: ["^reboot$"],
      pathDenyPrefixes: ["/secret"],
    });

    expect(
      engine.assertAllowed({
        action: "ssh.open",
        host: "prod.example",
        username: "root",
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));
    expect(
      engine.assertAllowed({
        action: "proc.sudo",
        command: "rm -rf /tmp/cache",
        rawSudo: true,
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));
    expect(() =>
      engine.assertAllowed({
        action: "proc.exec",
        command: "cat /etc/passwd",
      }),
    ).toThrow("does not match commandAllow");
    expect(() =>
      engine.assertAllowed({
        action: "proc.exec",
        command: "reboot",
      }),
    ).toThrow("matched commandDeny");
    expect(() =>
      engine.assertAllowed({
        action: "fs.rename",
        path: "/tmp/a",
        secondaryPath: "/secret/b",
      }),
    ).toThrow("denied by policy");
  });

  test("denies malformed and unscoped local transfer paths fail-closed", () => {
    const noLocalPrefixes = policy({
      localPathAllowPrefixes: [],
      localPathDenyPrefixes: [],
    });

    expect(() =>
      noLocalPrefixes.assertAllowed({
        action: "transfer.local.read",
        path: "/tmp/file.txt",
      }),
    ).toThrow("no allowed prefixes");

    const engine = policy({
      localPathAllowPrefixes: ["/tmp"],
      localPathDenyPrefixes: [],
    });
    expect(() =>
      engine.assertAllowed({
        action: "transfer.local.write",
        path: "bad\0path",
      }),
    ).toThrow("NUL");
  });

  test("covers tunnel allow-list denials and ignored invalid port policies", () => {
    const engine = policy({
      tunnelAllowBindHosts: ["127.0.0.1"],
      tunnelDenyBindHosts: [],
      tunnelAllowRemoteHosts: ["db.internal"],
      tunnelDenyRemoteHosts: [],
      tunnelAllowPorts: ["not-a-port", "1000-2000"],
      tunnelDenyPorts: ["99999", "3000"],
    });

    expect(() =>
      engine.assertAllowed({
        action: "tunnel.remote",
        localBindHost: "localhost",
        localPort: 1500,
        remoteHost: "db.internal",
        remotePort: 1501,
      }),
    ).toThrow("bind host localhost is outside allowed policy");
    expect(() =>
      engine.assertAllowed({
        action: "tunnel.remote",
        localBindHost: "127.0.0.1",
        localPort: 1500,
        remoteHost: "cache.internal",
        remotePort: 1501,
      }),
    ).toThrow("remote host cache.internal is outside allowed policy");
    expect(
      engine.assertAllowed({
        action: "tunnel.remote",
        localBindHost: "127.0.0.1",
        localPort: 1500,
        remoteHost: "db.internal",
        remotePort: 1501,
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));
  });

  test("uses default destructive prefixes when no custom remote prefixes are configured", () => {
    const engine = policy({ pathAllowPrefixes: [], pathDenyPrefixes: [] });

    expect(
      engine.assertAllowed({
        action: "fs.remove",
        path: "/home/deploy/cache",
        destructive: true,
      }),
    ).toEqual(expect.objectContaining({ allowed: true }));
    expect(() =>
      engine.assertAllowed({
        action: "fs.remove",
        path: "/srv/app",
        destructive: true,
      }),
    ).toThrow("outside allowed prefixes");
  });

  test("explain mode returns policy verdicts without throwing", () => {
    const observer = vi.fn();
    const engine = new PolicyEngine(policy().getEffectivePolicy(), observer);

    const decision = engine.assertAllowed({
      action: "proc.sudo",
      command: "id",
      rawSudo: true,
      mode: "explain",
    });

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: false,
        mode: "explain",
        reason: expect.stringContaining("Raw sudo"),
      }),
    );
    expect(observer).toHaveBeenCalledWith(
      decision,
      expect.objectContaining({ action: "proc.sudo" }),
    );
  });

  test("check reports non-throwing decisions to the observer", () => {
    const observer = vi.fn();
    const engine = new PolicyEngine(policy().getEffectivePolicy(), observer);

    const denied = engine.check({
      action: "proc.sudo",
      command: "id",
      rawSudo: true,
    });
    const allowed = engine.check({
      action: "proc.exec",
      command: "echo ok",
    });

    expect(denied).toEqual(expect.objectContaining({ allowed: false }));
    expect(allowed).toEqual(expect.objectContaining({ allowed: true }));
    expect(observer).toHaveBeenNthCalledWith(
      1,
      denied,
      expect.objectContaining({ action: "proc.sudo" }),
    );
    expect(observer).toHaveBeenNthCalledWith(
      2,
      allowed,
      expect.objectContaining({ action: "proc.exec" }),
    );
  });
});
