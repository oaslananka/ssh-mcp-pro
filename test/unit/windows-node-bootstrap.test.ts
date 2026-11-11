import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(repoRoot, "scripts/install-agent.ps1");

describe.skipIf(process.platform !== "win32")("Windows first-run Node bootstrap", () => {
  test.each(["success", "missing", "failure", "notfound"] as const)(
    "handles missing Node with WinGet %s without real installation",
    (mode) => {
      const root = mkdtempSync(path.join(os.tmpdir(), "ssh-win-node-bootstrap-"));
      const shimDir = path.join(root, "shims");
      const log = path.join(root, "steps.log");
      const ready = path.join(root, "node-ready.flag");
      mkdirSync(shimDir);
      try {
        writeFileSync(
          path.join(shimDir, "npm.cmd"),
          '@echo off\r\necho npm:%1>>"%TEST_LOG%"\r\nexit /b 0\r\n',
        );
        writeFileSync(
          path.join(shimDir, "ssh-mcp-pro-agent.cmd"),
          '@echo off\r\necho agent:%1>>"%TEST_LOG%"\r\nexit /b 0\r\n',
        );
        const wrapper = [
          "$ErrorActionPreference = 'Stop'",
          "function Get-Command {",
          "  [CmdletBinding()] param([string]$Name, [string]$CommandType)",
          "  if ($Name -eq 'node.exe') {",
          "    if (-not (Test-Path -LiteralPath $env:TEST_NODE_READY)) { return }",
          "    return Microsoft.PowerShell.Core\\Get-Command node.exe -CommandType Application | Select-Object -First 1",
          "  }",
          "  if ($Name -eq 'winget.exe') {",
          "    if ($env:TEST_WINGET_MODE -eq 'missing') { return }",
          "    return [pscustomobject]@{ Source = 'winget' }",
          "  }",
          "  return Microsoft.PowerShell.Core\\Get-Command -Name $Name -ErrorAction SilentlyContinue",
          "}",
          "function winget {",
          "  Add-Content -LiteralPath $env:TEST_LOG ('winget:' + ($args -join ' '))",
          "  if ($env:TEST_WINGET_MODE -eq 'failure') { $global:LASTEXITCODE = 17; return }",
          "  if ($env:TEST_WINGET_MODE -ne 'notfound') { Set-Content -LiteralPath $env:TEST_NODE_READY 'installed' }",
          "  $global:LASTEXITCODE = 0",
          "}",
          "function New-ScheduledTaskAction { return 'action' }",
          "function New-ScheduledTaskTrigger { return 'trigger' }",
          "function New-ScheduledTaskSettingsSet { return 'settings' }",
          "function Register-ScheduledTask { Add-Content -LiteralPath $env:TEST_LOG 'task:registered' }",
          "function Start-ScheduledTask { Add-Content -LiteralPath $env:TEST_LOG 'task:started' }",
          "$source = [System.IO.File]::ReadAllText($env:TEST_INSTALLER)",
          "& ([scriptblock]::Create($source)) -Server 'https://fixture.invalid' -Token 'fixture-token' -Alias 'new-windows'",
        ].join("\n");
        const result = spawnSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Restricted", "-Command", wrapper],
          {
            encoding: "utf8",
            timeout: 20_000,
            env: {
              ...process.env,
              PATH: [shimDir, process.env.PATH ?? ""].join(path.delimiter),
              TEST_LOG: log,
              TEST_NODE_READY: ready,
              TEST_WINGET_MODE: mode,
              TEST_INSTALLER: installer,
            },
          },
        );
        const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/u) : [];
        if (mode === "success") {
          expect(result.status, result.stderr).toBe(0);
          expect(lines).toEqual([
            expect.stringContaining(
              "winget:install --id OpenJS.NodeJS.LTS --exact --source winget",
            ),
            "npm:install",
            "agent:enroll",
            "task:registered",
            "task:started",
          ]);
        } else {
          expect(result.status).not.toBe(0);
          expect(result.stderr).toMatch(
            mode === "missing"
              ? /WinGet.*unavailable/u
              : mode === "failure"
                ? /WinGet.*failed/u
                : /Node\.js.*PATH/u,
          );
          expect(lines).toEqual(
            mode === "missing" ? [] : [expect.stringContaining("winget:install")],
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25_000,
  );
});
