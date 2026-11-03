import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repoRoot, "scripts/install-agent.sh");
const windowsScript = path.join(repoRoot, "scripts/install-agent.ps1");

function runScript(...args: string[]) {
  return spawnSync("bash", [script, ...args], { encoding: "utf8", timeout: 5_000 });
}

describe.skipIf(process.platform === "win32")("agent bootstrap Bash validation", () => {
  test("retains Bash syntax compatibility", () => {
    const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  test("displays usage without installing or enrolling", () => {
    const result = runScript("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--server");
    expect(result.stdout).toContain("--system");
  });

  test.each([
    [[], "--server is required"],
    [["--server", "https://example.invalid"], "--token is required"],
    [["--token", "test-placeholder"], "--server is required"],
    [["--server", "", "--token", "test-placeholder"], "--server is required"],
    [
      ["--server", "https://example.invalid", "--token", "test-placeholder", "--alias", ""],
      "--alias must not be empty",
    ],
    [["--unsupported"], "unknown argument: --unsupported"],
  ])("rejects invalid bootstrap arguments without running npm: %j", (args, expected) => {
    const result = runScript(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
  });
});

describe("Windows agent Scheduled Task launcher", () => {
  test("starts npm's CMD shim, not the PowerShell wrapper", () => {
    const content = readFileSync(windowsScript, "utf8");
    expect(content).toContain("Get-Command ssh-mcp-pro-agent.cmd -CommandType Application");
    expect(content).toContain(
      'New-ScheduledTaskAction -Execute "cmd.exe" -Argument $taskArguments',
    );
    expect(content).toContain("/d /s /c");
    expect(content).toContain('""{0}" run"');
  });
});
