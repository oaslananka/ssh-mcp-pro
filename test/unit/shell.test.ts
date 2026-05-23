import { describe, expect, test } from "@jest/globals";
import {
  buildPosixCommand,
  buildPowerShellCommand,
  buildRemoteCommand,
  buildSudoCommand,
  resolveRemoteTempDir,
} from "../../src/shell.js";

describe("shell helpers", () => {
  test("buildPosixCommand handles env and cwd", () => {
    const command = buildPosixCommand("echo hi", "/tmp/demo", { NAME: "value" }, "bash");

    expect(command).toContain("bash -lc");
    expect(command).toContain("/tmp/demo");
    expect(command).toContain("export NAME=");
    expect(command).toContain("value");
  });

  test("buildPowerShellCommand handles env and cwd", () => {
    const command = buildPowerShellCommand("Write-Host hi", "C:/Temp", { NAME: "value" });

    expect(command).toContain("powershell -NoLogo");
    expect(command).toContain("$env:NAME");
    expect(command).toContain("value");
    expect(command).toContain("Set-Location -Path");
    expect(command).toContain("C:/Temp");
  });

  test("buildRemoteCommand chooses platform-appropriate shell", () => {
    expect(
      buildRemoteCommand("echo hi", {
        platform: "windows",
        distro: "windows",
        version: "11",
        arch: "x64",
        shell: "powershell",
        packageManager: "winget",
        init: "windows-service",
      }),
    ).toContain("powershell");

    expect(
      buildRemoteCommand("echo hi", {
        platform: "linux",
        distro: "ubuntu",
        version: "22.04",
        arch: "x64",
        shell: "bash",
        packageManager: "apt",
        init: "systemd",
        defaultShell: "bash",
      }),
    ).toContain("bash -lc");
  });

  test("buildSudoCommand never embeds sudo passwords and rejects windows", () => {
    const command = buildSudoCommand(
      "apt-get update",
      {
        platform: "linux",
        distro: "ubuntu",
        version: "22.04",
        arch: "x64",
        shell: "bash",
        packageManager: "apt",
        init: "systemd",
        defaultShell: "bash",
      },
      "/tmp",
    );

    expect(command).toContain("sudo -n");
    expect(command).not.toContain("sudo -S");
    expect(command).not.toContain("secret");
    expect(command).toContain("/tmp");
    expect(() =>
      buildSudoCommand("dir", {
        platform: "windows",
        distro: "windows",
        version: "11",
        arch: "x64",
        shell: "powershell",
        packageManager: "winget",
        init: "windows-service",
      }),
    ).toThrow("Sudo is not supported");
  });

  test.each([["A=B"], ["A;id"], ["A$(id)"], ["A name"], [""]])(
    "rejects invalid environment variable key %p",
    (key) => {
      expect(() => buildPosixCommand("echo hi", undefined, { [key]: "value" })).toThrow(
        "Invalid environment variable name",
      );
      expect(() => buildPowerShellCommand("Write-Host hi", undefined, { [key]: "value" })).toThrow(
        "Invalid environment variable name",
      );
    },
  );

  test.each(["_A", "A1", "PATH_SAFE"])("accepts safe environment variable key %p", (key) => {
    expect(buildPosixCommand("echo hi", undefined, { [key]: "value" })).toContain(`export ${key}=`);
    expect(buildPowerShellCommand("Write-Host hi", undefined, { [key]: "value" })).toContain(
      `$env:${key}`,
    );
  });

  test("resolveRemoteTempDir falls back by platform", () => {
    expect(
      resolveRemoteTempDir({
        platform: "windows",
        distro: "windows",
        version: "11",
        arch: "x64",
        shell: "powershell",
        packageManager: "winget",
        init: "windows-service",
        tempDir: "C:\\Temp",
      }),
    ).toBe("C:/Temp");
    expect(
      resolveRemoteTempDir({
        platform: "linux",
        distro: "ubuntu",
        version: "22.04",
        arch: "x64",
        shell: "bash",
        packageManager: "apt",
        init: "systemd",
      }),
    ).toBe("/tmp");
  });
});
