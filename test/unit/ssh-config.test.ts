import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

describe("SSH config cache management", () => {
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-22T00:00:00Z"));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-config-test-"));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("re-parses config after TTL expires", async () => {
    const mod = await import("../../src/ssh-config.js");
    const parseSpy = jest.spyOn(mod.SSHConfigParser.prototype, "parse").mockResolvedValue();

    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date("2026-03-22T00:04:59Z"));
    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date("2026-03-22T00:05:01Z"));
    await mod.getSSHConfigParser();
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  test("invalidateSSHConfigCache forces a fresh parse", async () => {
    const mod = await import("../../src/ssh-config.js");
    const parseSpy = jest.spyOn(mod.SSHConfigParser.prototype, "parse").mockResolvedValue();

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

  test("handles missing config files gracefully", async () => {
    const missingPath = path.join(tempDir, "missing-config");
    const { SSHConfigParser } = await import("../../src/ssh-config.js");
    const parser = new SSHConfigParser(missingPath);

    await expect(parser.parse()).resolves.toBeUndefined();
    expect(parser.getAllHosts()).toEqual([]);
    expect(parser.resolveHost("unknown-host")).toEqual({ host: "unknown-host" });
  });
});
