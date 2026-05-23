import { describe, expect, jest, test } from "@jest/globals";
import { ErrorCode } from "../../src/types.js";
import { createEnsureService } from "../../src/ensure.js";

function createDeps() {
  return {
    sessionManager: {
      getSession: jest.fn(() => ({ ssh: {} }) as any) as any,
      getOSInfo: jest.fn(async () => ({
        platform: "linux" as const,
        distro: "ubuntu",
        version: "22.04",
        arch: "x64",
        shell: "bash",
        packageManager: "apt" as const,
        init: "systemd" as const,
        defaultShell: "bash" as const,
      })) as any,
    },
    processService: {
      execCommand: jest.fn() as any,
      execSudo: jest.fn() as any,
      commandExists: jest.fn() as any,
    },
    fsService: {
      readFile: jest.fn() as any,
      writeFile: jest.fn() as any,
      pathExists: jest.fn() as any,
    },
  };
}

describe("createEnsureService", () => {
  test("validates package names", async () => {
    const deps = createDeps();
    const service = createEnsureService(deps as any);

    await expect(service.ensurePackage("session-1", "bad;name")).rejects.toMatchObject({
      code: ErrorCode.EBADREQ,
    });
  });

  test("installs and removes packages as needed", async () => {
    const deps = createDeps();
    deps.processService.execCommand
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    deps.processService.execSudo
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "", durationMs: 1 })
      .mockResolvedValueOnce({ code: 0, stdout: "removed", stderr: "", durationMs: 1 });
    const service = createEnsureService(deps as any);

    await expect(service.ensurePackage("session-1", "nginx", "present")).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        pm: "apt",
      }),
    );
    await expect(service.ensurePackage("session-1", "nginx", "absent")).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        pm: "apt",
      }),
    );
  });

  test("returns early when package is already in desired state", async () => {
    const deps = createDeps();
    deps.processService.execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    const service = createEnsureService(deps as any);

    await expect(service.ensurePackage("session-1", "curl", "present")).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    await expect(service.ensurePackage("session-1", "curl", "absent")).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  test("handles unsupported package managers and init systems", async () => {
    const deps = createDeps();
    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "linux",
      distro: "ubuntu",
      version: "22.04",
      arch: "x64",
      shell: "bash",
      packageManager: "unknown" as const,
      init: "systemd",
      defaultShell: "bash",
    });
    const service = createEnsureService(deps as any);

    await expect(service.ensurePackage("session-1", "curl")).rejects.toMatchObject({
      code: ErrorCode.EPMGR,
    });

    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "linux",
      distro: "ubuntu",
      version: "22.04",
      arch: "x64",
      shell: "bash",
      packageManager: "apt",
      init: "unknown" as const,
      defaultShell: "bash",
    });

    await expect(service.ensureService("session-1", "nginx", "started")).rejects.toMatchObject({
      code: ErrorCode.ENOSUDO,
    });
  });

  test.each([
    ["dnf", "dnf list installed tree", "dnf install -y tree", "dnf remove -y tree"],
    ["yum", "yum list installed tree", "yum install -y tree", "yum remove -y tree"],
    ["pacman", "pacman -Q tree", "pacman -S --noconfirm tree", "pacman -R --noconfirm tree"],
    ["apk", "apk info -e tree", "apk add tree", "apk del tree"],
    ["zypper", "zypper se -i tree", "zypper install -y tree", "zypper remove -y tree"],
  ])(
    "uses %s package manager commands for install and removal",
    async (packageManager, checkCommand, installCommand, removeCommand) => {
      const installDeps = createDeps();
      installDeps.sessionManager.getOSInfo.mockResolvedValue({
        platform: "linux",
        distro: "custom",
        version: "1",
        arch: "x64",
        shell: "bash",
        packageManager,
        init: "systemd",
        defaultShell: "bash",
      });
      installDeps.processService.execCommand.mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "",
      });
      installDeps.processService.execSudo.mockResolvedValueOnce({
        code: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 1,
      });

      const installService = createEnsureService(installDeps as any);
      await expect(installService.ensurePackage("session-1", "tree", "present")).resolves.toEqual(
        expect.objectContaining({ ok: true, pm: packageManager }),
      );
      expect(installDeps.processService.execCommand).toHaveBeenCalledWith(
        "session-1",
        checkCommand,
      );
      expect(installDeps.processService.execSudo).toHaveBeenCalledWith(
        "session-1",
        installCommand,
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          policyAction: "ensure.package",
          rawSudo: false,
        }),
      );

      const removeDeps = createDeps();
      removeDeps.sessionManager.getOSInfo.mockResolvedValue({
        platform: "linux",
        distro: "custom",
        version: "1",
        arch: "x64",
        shell: "bash",
        packageManager,
        init: "systemd",
        defaultShell: "bash",
      });
      removeDeps.processService.execCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "installed",
        stderr: "",
      });
      removeDeps.processService.execSudo.mockResolvedValueOnce({
        code: 0,
        stdout: "removed",
        stderr: "",
        durationMs: 1,
      });

      const removeService = createEnsureService(removeDeps as any);
      await expect(removeService.ensurePackage("session-1", "tree", "absent")).resolves.toEqual(
        expect.objectContaining({ ok: true, pm: packageManager }),
      );
      expect(removeDeps.processService.execCommand).toHaveBeenCalledWith("session-1", checkCommand);
      expect(removeDeps.processService.execSudo).toHaveBeenCalledWith(
        "session-1",
        removeCommand,
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          destructive: true,
          policyAction: "ensure.package",
          rawSudo: false,
        }),
      );
    },
  );

  test("manages services through init systems", async () => {
    const deps = createDeps();
    deps.processService.execSudo.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });
    const service = createEnsureService(deps as any);

    await expect(service.ensureService("session-1", "nginx", "started")).resolves.toEqual({
      ok: true,
    });
    expect(deps.processService.execSudo).toHaveBeenCalledWith(
      "session-1",
      "systemctl start nginx",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        destructive: false,
        policyAction: "ensure.service",
        rawSudo: false,
      }),
    );
  });

  test.each([
    ["systemd", "stopped", "systemctl stop nginx"],
    ["systemd", "restarted", "systemctl restart nginx"],
    ["systemd", "enabled", "systemctl enable nginx"],
    ["systemd", "disabled", "systemctl disable nginx"],
    ["service", "started", "service nginx start"],
    ["service", "stopped", "service nginx stop"],
    ["service", "restarted", "service nginx restart"],
    ["service", "enabled", "chkconfig nginx on || update-rc.d nginx enable"],
  ])("builds %s commands for %s state", async (init, state, expectedCommand) => {
    const deps = createDeps();
    deps.sessionManager.getOSInfo.mockResolvedValue({
      platform: "linux",
      distro: "ubuntu",
      version: "22.04",
      arch: "x64",
      shell: "bash",
      packageManager: "apt",
      init,
      defaultShell: "bash",
    });
    deps.processService.execSudo.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });
    const service = createEnsureService(deps as any);

    await expect(service.ensureService("session-1", "nginx", state as any)).resolves.toEqual({
      ok: true,
    });
    expect(deps.processService.execSudo).toHaveBeenCalledWith(
      "session-1",
      expectedCommand,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        policyAction: "ensure.service",
        rawSudo: false,
      }),
    );
  });

  test("ensures lines are present, absent, and sudo-fallback writable", async () => {
    const deps = createDeps();
    deps.fsService.pathExists.mockResolvedValue(true);
    deps.fsService.readFile.mockResolvedValue("one\ntwo");
    deps.fsService.writeFile
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("permission"))
      .mockResolvedValueOnce(true);
    deps.processService.execSudo.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });
    const service = createEnsureService(deps as any);

    await expect(service.ensureLinesInFile("session-1", "/tmp/demo", ["three"])).resolves.toEqual({
      ok: true,
      added: 1,
    });
    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["two"], true, "absent"),
    ).resolves.toEqual({ ok: true, added: -1 });
    expect(deps.processService.execSudo).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("mv "),
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        path: "/tmp/demo",
        policyAction: "ensure.lines",
        rawSudo: false,
      }),
    );
  });

  test("does not hide non-permission write failures behind sudo fallback", async () => {
    const deps = createDeps();
    deps.fsService.pathExists.mockResolvedValue(true);
    deps.fsService.readFile.mockResolvedValue("alpha");
    deps.fsService.writeFile.mockRejectedValueOnce(
      Object.assign(new Error("disk full"), { code: "ENOSPC" }),
    );
    const service = createEnsureService(deps as any);

    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["beta"], true),
    ).rejects.toThrow("disk full");
    expect(deps.processService.execSudo).not.toHaveBeenCalled();
    expect(deps.fsService.writeFile).toHaveBeenCalledTimes(1);
  });

  test("reports direct and temporary write failures during sudo fallback", async () => {
    const deps = createDeps();
    deps.fsService.pathExists.mockResolvedValue(true);
    deps.fsService.readFile.mockResolvedValue("alpha");
    deps.fsService.writeFile
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockRejectedValueOnce(new Error("tmp full"));
    const service = createEnsureService(deps as any);

    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["beta"], true),
    ).rejects.toMatchObject({
      code: ErrorCode.EFS,
      message: expect.stringContaining("Failed to stage temporary file"),
      hint: expect.stringContaining("temporary write failed with tmp full"),
    });
    expect(deps.processService.execSudo).not.toHaveBeenCalled();
  });

  test("errors when createIfMissing is false for absent files", async () => {
    const deps = createDeps();
    deps.fsService.pathExists.mockResolvedValue(false);
    const service = createEnsureService(deps as any);

    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["x"], false),
    ).rejects.toMatchObject({ code: ErrorCode.EFS });
    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["x"], true, "absent"),
    ).resolves.toEqual({ ok: true, added: 0 });
  });

  test("returns unchanged when lines are already present or already absent", async () => {
    const deps = createDeps();
    deps.fsService.pathExists.mockResolvedValue(true);
    deps.fsService.readFile.mockResolvedValue("alpha\nbeta");
    const service = createEnsureService(deps as any);

    await expect(service.ensureLinesInFile("session-1", "/tmp/demo", ["alpha"])).resolves.toEqual({
      ok: true,
      added: 0,
    });
    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["gamma"], true, "absent"),
    ).resolves.toEqual({ ok: true, added: 0 });
  });

  test("applies patches and cleans up temp files", async () => {
    const deps = createDeps();
    deps.processService.commandExists.mockResolvedValue(true);
    deps.fsService.writeFile.mockResolvedValue(true);
    deps.processService.execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 1 })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 1 })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 1 });
    const service = createEnsureService(deps as any);

    await expect(
      service.applyPatch("session-1", "/tmp/demo", "@@ -1 +1 @@\n-old\n+new"),
    ).resolves.toEqual({ ok: true, changed: true });
    expect(deps.processService.execCommand).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.stringContaining("patch --dry-run"),
    );
  });

  test("falls back to sudo for patches and uses windows cleanup commands", async () => {
    const deps = createDeps();
    deps.sessionManager.getOSInfo.mockResolvedValue({
      platform: "windows",
      distro: "windows",
      version: "11",
      arch: "x64",
      shell: "powershell",
      packageManager: "winget",
      init: "windows-service",
    });
    deps.processService.commandExists.mockResolvedValue(true);
    deps.fsService.writeFile.mockResolvedValue(true);
    deps.processService.execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 1 })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission", durationMs: 1 })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 1 });
    deps.processService.execSudo.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });
    const service = createEnsureService(deps as any);

    await expect(service.applyPatch("session-1", "C:/Temp/demo.txt", "diff")).resolves.toEqual({
      ok: true,
      changed: true,
    });
    expect(deps.processService.execSudo).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("patch -p0"),
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        path: "C:/Temp/demo.txt",
        policyAction: "patch.apply",
        rawSudo: false,
      }),
    );
    expect(deps.processService.execCommand).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("Remove-Item -Path"),
    );
  });

  test("uses brew without sudo and service init alternatives", async () => {
    const deps = createDeps();
    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "darwin",
      distro: "macos",
      version: "14.0",
      arch: "arm64",
      shell: "zsh",
      packageManager: "brew",
      init: "launchd",
      defaultShell: "sh",
    });
    deps.processService.execCommand
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "", durationMs: 1 });
    const service = createEnsureService(deps as any);

    await expect(service.ensurePackage("session-1", "wget", "present")).resolves.toEqual(
      expect.objectContaining({ ok: true, pm: "brew" }),
    );
    expect(deps.processService.execCommand).toHaveBeenLastCalledWith(
      "session-1",
      "brew install wget",
    );

    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "linux",
      distro: "ubuntu",
      version: "22.04",
      arch: "x64",
      shell: "bash",
      packageManager: "apt",
      init: "service",
      defaultShell: "bash",
    });
    deps.processService.execSudo.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await expect(service.ensureService("session-1", "nginx", "disabled")).resolves.toEqual({
      ok: true,
    });
    expect(deps.processService.execSudo).toHaveBeenLastCalledWith(
      "session-1",
      "chkconfig nginx off || update-rc.d nginx disable",
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        destructive: true,
        policyAction: "ensure.service",
        rawSudo: false,
      }),
    );
  });

  test("handles launchd and windows-service guardrails", async () => {
    const deps = createDeps();
    const service = createEnsureService(deps as any);

    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "darwin",
      distro: "macos",
      version: "14.0",
      arch: "arm64",
      shell: "zsh",
      packageManager: "brew",
      init: "launchd",
      defaultShell: "sh",
    });
    await expect(service.ensureService("session-1", "nginx", "started")).rejects.toMatchObject({
      code: ErrorCode.ENOSUDO,
    });

    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "windows",
      distro: "windows",
      version: "11",
      arch: "x64",
      shell: "powershell",
      packageManager: "winget",
      init: "windows-service",
    });
    await expect(service.ensureService("session-1", "Spooler", "started")).rejects.toMatchObject({
      code: ErrorCode.ENOSUDO,
    });
  });

  test("covers patch failure branches", async () => {
    const deps = createDeps();
    const service = createEnsureService(deps as any);

    deps.processService.commandExists.mockResolvedValue(false);
    await expect(service.applyPatch("session-1", "/tmp/demo", "diff")).rejects.toMatchObject({
      code: ErrorCode.EPATCH,
    });

    deps.processService.commandExists.mockResolvedValue(true);
    deps.fsService.writeFile.mockResolvedValue(true);
    deps.processService.execCommand
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "bad patch", durationMs: 1 })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 1 });
    await expect(service.applyPatch("session-1", "/tmp/demo", "diff")).rejects.toMatchObject({
      code: ErrorCode.EPATCH,
    });
  });

  test("rejects Windows package management and failed privileged file moves", async () => {
    const deps = createDeps();
    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "windows",
      distro: "windows",
      version: "11",
      arch: "x64",
      shell: "powershell",
      packageManager: "winget",
      init: "windows-service",
    });
    const service = createEnsureService(deps as any);

    await expect(service.ensurePackage("session-1", "git")).rejects.toMatchObject({
      code: ErrorCode.EPMGR,
    });

    deps.sessionManager.getOSInfo.mockResolvedValueOnce({
      platform: "linux",
      distro: "ubuntu",
      version: "22.04",
      arch: "x64",
      shell: "bash",
      packageManager: "apt",
      init: "systemd",
      defaultShell: "bash",
    });
    deps.fsService.pathExists.mockResolvedValue(true);
    deps.fsService.readFile.mockResolvedValue("alpha");
    deps.fsService.writeFile
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(true);
    deps.processService.execSudo.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "nope",
      durationMs: 1,
    });

    await expect(
      service.ensureLinesInFile("session-1", "/tmp/demo", ["beta"], true),
    ).rejects.toMatchObject({ code: ErrorCode.EFS });
  });
});
