import { exec } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test, vi } from "vitest";
import { detectOS } from "../../src/detect.js";
import { createEnsureService } from "../../src/ensure.js";
import type { PackageManager } from "../../src/types.js";

const execAsync = promisify(exec);
const RUN_WINDOWS_INTEGRATION =
  process.env.RUN_WINDOWS_SSH_INTEGRATION === "1" && process.platform === "win32";
const windowsDescribe = RUN_WINDOWS_INTEGRATION ? describe : describe.skip;
const unsupportedUnixCommands = new Set(["uname -m", "uname -s"]);

type ExecFailure = Error & {
  code?: number | string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function text(value: string | Buffer | undefined): string {
  return typeof value === "string" ? value : (value?.toString("utf8") ?? "");
}

function createLocalWindowsSsh() {
  return {
    execCommand: vi.fn(async (command: string) => {
      if (unsupportedUnixCommands.has(command)) {
        return { code: 1, stdout: "", stderr: `${command}: not found` };
      }
      if (
        command ===
          'powershell -NoLogo -NoProfile -Command "Get-Command winget -ErrorAction SilentlyContinue"' ||
        command === "choco -v"
      ) {
        return { code: 1, stdout: "", stderr: "" };
      }

      try {
        const result = await execAsync(command, {
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        });
        return { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const failure = error as ExecFailure;
        return {
          code: typeof failure.code === "number" ? failure.code : 1,
          stdout: text(failure.stdout),
          stderr: text(failure.stderr) || failure.message,
        };
      }
    }),
  };
}

function createWindowsEnsureService(packageManager: PackageManager) {
  const execCommand = vi
    .fn()
    .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "", durationMs: 1 })
    .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "", durationMs: 1 });
  const execSudo = vi.fn();

  return {
    execCommand,
    execSudo,
    service: createEnsureService({
      sessionManager: {
        getSession: vi.fn(() => ({ ssh: {} }) as any),
        getOSInfo: vi.fn(async () => ({
          platform: "windows" as const,
          distro: "windows",
          version: "11",
          arch: "x64",
          shell: "powershell",
          packageManager,
          init: "windows-service" as const,
          defaultShell: "powershell" as const,
        })),
      },
      processService: {
        execCommand,
        execSudo,
        commandExists: vi.fn(),
      },
      fsService: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        pathExists: vi.fn(),
      },
    }),
  };
}

windowsDescribe("Windows SSH integration coverage", () => {
  test("os_detect uses the PowerShell-capable Windows command path", async () => {
    const result = await detectOS(createLocalWindowsSsh() as any);

    expect(result).toEqual(
      expect.objectContaining({
        platform: "windows",
        distro: "windows",
        defaultShell: "powershell",
        init: "windows-service",
      }),
    );
    expect(result.tempDir).toMatch(/^[A-Za-z]:\//u);
  }, 20_000);

  test.each([
    ["winget", "Git.Git", "winget install --id Git.Git"],
    ["choco", "git", "choco install git"],
  ] as const)(
    "ensure_package dispatches through %s",
    async (packageManager, packageName, prefix) => {
      const { execCommand, execSudo, service } = createWindowsEnsureService(packageManager);

      await expect(service.ensurePackage("session-1", packageName, "present")).resolves.toEqual(
        expect.objectContaining({ ok: true, pm: packageManager }),
      );

      expect(execCommand).toHaveBeenCalledWith("session-1", expect.stringContaining(prefix));
      expect(execSudo).not.toHaveBeenCalled();
    },
  );
});
