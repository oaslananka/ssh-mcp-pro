import { afterEach, beforeEach, describe, expect, vi, test } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

describe("SSH config cache management", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T00:00:00Z"));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-config-test-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("re-parses config after TTL expires", async () => {
    const mod = await import("../../src/ssh-config.js");
    const parseSpy = vi.spyOn(mod.SSHConfigParser.prototype, "parse").mockResolvedValue();

    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-03-22T00:04:59Z"));
    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-03-22T00:05:01Z"));
    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  test("invalidateSSHConfigCache forces a fresh parse", async () => {
    const mod = await import("../../src/ssh-config.js");
    const parseSpy = vi.spyOn(mod.SSHConfigParser.prototype, "parse").mockResolvedValue();

    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    mod.invalidateSSHConfigCache();
    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  test("parses host options and wildcard matches from config file", async () => {
    const configPath = path.join(tempDir, "config");
    fs.writeFileSync(
      configPath,
      [
        "Host web",
        "  HostName web.example.com",
        "  User deploy",
        "  Port 2222",
        "  IdentityFile ~/.ssh/id_ed25519",
        "  ProxyJump bastion",
        "Host *.internal",
        "  User ops",
      ].join("\n"),
    );

    const { SSHConfigParser } = await import("../../src/ssh-config.js");
    const parser = new SSHConfigParser(configPath);

    await parser.parse();

    expect(parser.getAllHosts()).toEqual(["web", "*.internal"]);
    expect(parser.resolveHost("web")).toEqual({
      host: "web.example.com",
      username: "deploy",
      port: 2222,
      privateKeyPath: path.join(os.homedir(), ".ssh", "id_ed25519"),
      proxyJump: "bastion",
    });
    expect(parser.resolveHost("api.internal")).toEqual({
      host: "api.internal",
      username: "ops",
    });
  });

  test("parses long whitespace runs without requiring a backtracking key-value regex", async () => {
    const configPath = path.join(tempDir, "long-whitespace-config");
    fs.writeFileSync(
      configPath,
      [
        "Host" + " ".repeat(40_000) + "large",
        "  HostName	  large.example.test",
        "  User	" + " ".repeat(40_000) + "operator",
        "InvalidLineWithoutValue",
        "  ProxyJump   ",
      ].join("\n"),
    );

    const { SSHConfigParser } = await import("../../src/ssh-config.js");
    const parser = new SSHConfigParser(configPath);
    await parser.parse();

    expect(parser.getAllHosts()).toEqual(["large"]);
    expect(parser.resolveHost("large")).toEqual({
      host: "large.example.test",
      username: "operator",
    });
  });

  test("applies Host options to every alias in a multi-pattern declaration", async () => {
    const configPath = path.join(tempDir, "multi-alias-config");
    fs.writeFileSync(
      configPath,
      [
        "Host build build-alt *.build.test",
        "  HostName builder.example.test",
        "  User builder",
        "  Port 2201",
        "  IdentityFile ~/.ssh/build-key",
        "Host deploy",
        "  HostName deploy.example.test",
        "  User deployer",
      ].join("\n"),
    );
    const { SSHConfigParser } = await import("../../src/ssh-config.js");
    const parser = new SSHConfigParser(configPath);
    await parser.parse();
    expect(parser.getAllHosts()).toEqual(["build", "build-alt", "*.build.test", "deploy"]);
    for (const alias of ["build", "build-alt", "runner.build.test"]) {
      expect(parser.resolveHost(alias)).toEqual({
        host: "builder.example.test",
        username: "builder",
        port: 2201,
        privateKeyPath: path.join(os.homedir(), ".ssh", "build-key"),
      });
    }
    expect(parser.getHostConfig("build")?.host).toBe("build");
    expect(parser.getHostConfig("build-alt")?.host).toBe("build-alt");
    expect(parser.resolveHost("deploy")).toEqual({
      host: "deploy.example.test",
      username: "deployer",
    });
  });

  test("handles missing config files gracefully", async () => {
    const missingPath = path.join(tempDir, "missing-config");
    const { SSHConfigParser } = await import("../../src/ssh-config.js");
    const parser = new SSHConfigParser(missingPath);

    await expect(parser.parse()).resolves.toBeUndefined();
    expect(parser.getAllHosts()).toEqual([]);
    expect(parser.resolveHost("unknown-host")).toEqual({ host: "unknown-host" });
  });
});
