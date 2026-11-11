import { exec, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { capture } from "../../scripts/lib/command.mjs";
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
  test("runs the PowerShell agent installer through enrollment and Scheduled Task setup", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssh mcp windows installer "));
    const shim = join(dir, "fake agent.cmd");
    const npmShim = join(dir, "fake npm.cmd");
    const npmLog = join(dir, "npm-invocation.txt");
    const log = join(dir, "agent-invocation.txt");
    const harness = join(dir, "bootstrap-test.ps1");
    try {
      // The native installer runs, but npm, enrollment and Scheduled Task
      // side effects are all replaced by local disposable fixtures.
      writeFileSync(shim, '@echo off\r\n>> "%SSH_MCP_TEST_AGENT_ARGS%" echo %*\r\nexit /b 0\r\n');
      writeFileSync(npmShim, '@echo off\r\n>> "%SSH_MCP_TEST_NPM_ARGS%" echo %*\r\nexit /b 0\r\n');
      writeFileSync(
        harness,
        String.raw`param([string]$Installer, [string]$AgentShim, [string]$NpmShim)
$ErrorActionPreference = 'Stop'
$global:sshMcpSmokeAgentShim = $AgentShim
$global:sshMcpSmokeNpmShim = $NpmShim
$global:sshMcpSmokeRegistered = $null
$global:sshMcpSmokeStarted = $null

function Get-Command {
  [CmdletBinding()]
  param([string]$Name, [string]$CommandType)
  if ($Name -eq 'npm.cmd') {
    return [pscustomobject]@{ Source = $global:sshMcpSmokeNpmShim }
  }
  if ($Name -in @('ssh-mcp-pro-agent', 'ssh-mcp-pro-agent.cmd')) {
    return [pscustomobject]@{ Source = $global:sshMcpSmokeAgentShim }
  }
  Microsoft.PowerShell.Core\Get-Command -Name $Name -ErrorAction SilentlyContinue
}
function New-ScheduledTaskAction {
  param([string]$Execute, [string]$Argument)
  [pscustomobject]@{ Execute = $Execute; Argument = $Argument }
}
function New-ScheduledTaskTrigger {
  param([switch]$AtLogOn)
  [pscustomobject]@{ AtLogOn = $AtLogOn.IsPresent }
}
function New-ScheduledTaskSettingsSet {
  param(
    [switch]$AllowStartIfOnBatteries,
    [switch]$DontStopIfGoingOnBatteries,
    [int]$RestartCount,
    [timespan]$RestartInterval,
    [switch]$StartWhenAvailable
  )
  [pscustomobject]@{
    RestartCount = $RestartCount
    RestartInterval = $RestartInterval
  }
}
function Register-ScheduledTask {
  param(
    [string]$TaskName,
    [object]$Action,
    [object]$Trigger,
    [object]$Settings,
    [string]$Description,
    [switch]$Force
  )
  $global:sshMcpSmokeRegistered = [pscustomobject]@{
    TaskName = $TaskName
    Action = $Action
    Trigger = $Trigger
    Settings = $Settings
  }
}
function Start-ScheduledTask {
  param([string]$TaskName)
  $global:sshMcpSmokeStarted = $TaskName
}

& $Installer -Server 'https://fixture.invalid' -Token 'fixture-only-token' -Alias 'fixture-windows' -Version '1.3.0' -TaskName 'ssh-mcp-pro-fixture'
if ($null -eq $global:sshMcpSmokeRegistered -or $null -eq $global:sshMcpSmokeStarted) {
  throw 'Installer did not register and start a task'
}
[pscustomobject]@{
  NpmArguments = @(((Get-Content -LiteralPath $env:SSH_MCP_TEST_NPM_ARGS -Raw).Trim()) -split '\s+')
  Execute = $global:sshMcpSmokeRegistered.Action.Execute
  Arguments = $global:sshMcpSmokeRegistered.Action.Argument
  TaskName = $global:sshMcpSmokeRegistered.TaskName
  AtLogOn = $global:sshMcpSmokeRegistered.Trigger.AtLogOn
  RestartCount = $global:sshMcpSmokeRegistered.Settings.RestartCount
  RestartMinutes = $global:sshMcpSmokeRegistered.Settings.RestartInterval.TotalMinutes
  Started = $global:sshMcpSmokeStarted
} | ConvertTo-Json -Compress -Depth 5 | ForEach-Object { 'BOOTSTRAP_SUMMARY=' + $_ }
`,
      );
      const proc = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          harness,
          join(process.cwd(), "scripts", "install-agent.ps1"),
          shim,
          npmShim,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 25_000,
          env: { ...process.env, SSH_MCP_TEST_AGENT_ARGS: log, SSH_MCP_TEST_NPM_ARGS: npmLog },
        },
      );
      expect(proc.error).toBeUndefined();
      expect(proc.status, proc.stderr || proc.stdout).toBe(0);
      const line = proc.stdout
        .split(/\r?\n/u)
        .find((item) => item.startsWith("BOOTSTRAP_SUMMARY="));
      expect(line).toBeDefined();
      const summary = JSON.parse(line!.slice("BOOTSTRAP_SUMMARY=".length)) as {
        NpmArguments: string[];
        Execute: string;
        Arguments: string;
        TaskName: string;
        AtLogOn: boolean;
        RestartCount: number;
        RestartMinutes: number;
        Started: string;
      };
      expect(summary.NpmArguments).toEqual(["install", "-g", "ssh-mcp-pro@1.3.0"]);
      expect(summary.Execute).toBe("cmd.exe");
      expect(summary.Arguments).toContain('/d /s /c ""');
      expect(summary.Arguments).toContain(`"${shim}" run"`);
      expect(summary.TaskName).toBe("ssh-mcp-pro-fixture");
      expect(summary.AtLogOn).toBe(true);
      expect(summary.RestartCount).toBe(999);
      expect(summary.RestartMinutes).toBe(1);
      expect(summary.Started).toBe(summary.TaskName);
      const invocation = readFileSync(log, "utf8").trim();
      expect(invocation).toContain("enroll --server https://fixture.invalid");
      expect(invocation).toContain("--token fixture-only-token --alias fixture-windows");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("invokes bundled npm and npx CLIs without PATH-selected cmd shims", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ssh-mcp-windows-path-"));
    const priorPath = process.env.PATH;
    try {
      for (const name of ["npm", "npx"]) {
        writeFileSync(join(tempDir, `${name}.cmd`), "@echo off\r\nexit /b 31\r\n");
      }
      process.env.PATH = `${tempDir}${delimiter}${priorPath ?? ""}`;
      for (const name of ["npm", "npx"]) {
        const result = capture(name, ["--version"]);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/^\d+/u);
      }
    } finally {
      process.env.PATH = priorPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  // Node 25+ runners may install Corepack outside the Node executable directory.
  // When bundled, require the shell-free path to resist a spoofed PATH shim;
  // otherwise verify that the existing global pnpm fallback still works.
  test("supports pnpm through bundled Corepack or the existing Windows fallback", () => {
    const bundledCorepack = existsSync(
      join(dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js"),
    );
    const tempDir = mkdtempSync(join(tmpdir(), "ssh-mcp-windows-pnpm-path-"));
    const priorPath = process.env.PATH;
    try {
      if (bundledCorepack) {
        writeFileSync(join(tempDir, "pnpm.cmd"), "@echo off\r\nexit /b 31\r\n");
        process.env.PATH = `${tempDir}${delimiter}${priorPath ?? ""}`;
      }
      const result = capture("pnpm", ["--version"]);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^\d+/u);
    } finally {
      process.env.PATH = priorPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
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
  }, 45_000);

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
