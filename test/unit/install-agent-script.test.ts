import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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
  test("uses Windows CMD shims for install and enrollment under restrictive PowerShell policies", () => {
    const content = readFileSync(windowsScript, "utf8");
    expect(content).toContain(
      "Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    );
    expect(content).toContain('& $npmCmd install -g "ssh-mcp-pro@$Version"');
    expect(content).toContain(
      "Get-Command ssh-mcp-pro-agent.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    );
    expect(content).toContain("& $agentCmd enroll --server $Server --token $Token --alias $Alias");
    expect(content).not.toContain("& $agentBin enroll");
    expect(content).not.toContain("npm install -g");
  });

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

describe.skipIf(process.platform !== "win32")("Windows restricted-policy enrollment smoke", () => {
  test("installs, enrolls and registers a task using CMD wrappers without executing PS1 shims", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ssh-agent-win-smoke-"));
    const shim = path.join(root, "shims");
    const log = path.join(root, "operations.txt");
    mkdirSync(shim);
    try {
      writeFileSync(
        path.join(shim, "npm.cmd"),
        '@echo off\r\necho npm:%1>>"%TEST_LOG%"\r\nexit /b 0\r\n',
      );
      writeFileSync(path.join(shim, "npm.ps1"), 'throw "npm.ps1 must not execute"\r\n');
      writeFileSync(
        path.join(shim, "ssh-mcp-pro-agent.cmd"),
        '@echo off\r\necho agent:%1>>"%TEST_LOG%"\r\nexit /b 0\r\n',
      );
      writeFileSync(
        path.join(shim, "ssh-mcp-pro-agent.ps1"),
        'throw "agent.ps1 must not execute"\r\n',
      );

      const wrapper = [
        '$ErrorActionPreference = "Stop"',
        'function New-ScheduledTaskAction { return "action" }',
        'function New-ScheduledTaskTrigger { return "trigger" }',
        'function New-ScheduledTaskSettingsSet { return "settings" }',
        'function Register-ScheduledTask { Add-Content $env:TEST_LOG "task:registered"; return "ok" }',
        'function Start-ScheduledTask { Add-Content $env:TEST_LOG "task:started" }',
        "$source = [System.IO.File]::ReadAllText($env:TEST_INSTALL_SCRIPT)",
        '& ([scriptblock]::Create($source)) -Server "https://example.invalid" -Token "disposable-test" -Alias "test-device"',
      ].join("; ");
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Restricted", "-Command", wrapper],
        {
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            PATH: [shim, process.env.PATH ?? ""].join(path.delimiter),
            TEST_LOG: log,
            TEST_INSTALL_SCRIPT: windowsScript,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(log, "utf8").trim().split(/\r?\n/u)).toEqual([
        "npm:install",
        "agent:enroll",
        "task:registered",
        "task:started",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "Linux npm global bin regression",
  () => {
    function stubFile(filename: string, body: string) {
      writeFileSync(filename, "#!/usr/bin/env bash\nset -euo pipefail\n" + body + "\n", {
        mode: 0o755,
      });
    }

    function setupInstaller(installAgent: boolean) {
      const root = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-pro-bootstrap-"));
      const shimDir = path.join(root, "shims");
      const home = path.join(root, "home");
      const prefix = path.join(root, "npm-global");
      const globalBin = path.join(prefix, "bin");
      const enrollLog = path.join(root, "enrollment.log");
      const installLog = path.join(root, "install.log");
      const serviceLog = path.join(root, "service.log");
      const serviceState = path.join(root, "service.state");
      mkdirSync(shimDir);
      mkdirSync(home);
      mkdirSync(globalBin, { recursive: true });

      stubFile(
        path.join(shimDir, "npm"),
        [
          'case "$1" in',
          '  prefix) [[ "${2:-}" == "-g" ]] || exit 11; printf "%s\\n" "$MOCK_NPM_PREFIX" ;;',
          '  install) [[ "${2:-}" == "-g" ]] || exit 12; printf "installed\\n" >> "$MOCK_INSTALL_LOG" ;;',
          "  *) exit 13 ;;",
          "esac",
        ].join("\n"),
      );
      stubFile(
        path.join(shimDir, "systemctl"),
        [
          'printf "%s\\n" "$*" >> "$MOCK_SERVICE_LOG"',
          'case "$*" in',
          '  "--user restart ssh-mcp-pro-agent.service") printf "restarted\\n" > "$MOCK_SERVICE_STATE" ;;',
          "esac",
        ].join("\n"),
      );
      stubFile(path.join(shimDir, "loginctl"), "exit 0");

      const agentBin = path.join(globalBin, "ssh-mcp-pro-agent");
      if (installAgent) {
        stubFile(agentBin, 'printf "%s|%s\\n" "$(id -u)" "$*" >> "$MOCK_ENROLL_LOG"');
      }

      const env = {
        ...process.env,
        PATH: [shimDir, path.dirname(process.execPath), process.env.PATH ?? "/usr/bin:/bin"].join(
          path.delimiter,
        ),
        HOME: home,
        USER: process.env.USER ?? "test-user",
        MOCK_NPM_PREFIX: prefix,
        MOCK_ENROLL_LOG: enrollLog,
        MOCK_INSTALL_LOG: installLog,
        MOCK_SERVICE_LOG: serviceLog,
        MOCK_SERVICE_STATE: serviceState,
      };

      const run = (...args: string[]) =>
        spawnSync(
          "bash",
          [
            script,
            "--server",
            "https://example.invalid",
            "--token",
            "placeholder",
            "--alias",
            "linux-test",
            ...args,
          ],
          { encoding: "utf8", env, timeout: 5_000 },
        );

      return {
        root,
        home,
        globalBin,
        agentBin,
        enrollLog,
        installLog,
        serviceLog,
        serviceState,
        env,
        run,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
      };
    }

    test("uses npm's global prefix/bin even when absent from PATH", () => {
      const mock = setupInstaller(true);
      try {
        expect(mock.env.PATH.split(path.delimiter)).not.toContain(mock.globalBin);
        const result = mock.run();
        expect(result.status).toBe(0);
        expect(readFileSync(mock.installLog, "utf8")).toContain("installed");
        const expectedEnrollmentArgs = [
          "enroll",
          "--server",
          "https://example.invalid",
          "--token",
          "placeholder",
          "--alias",
          "linux-test",
        ].join(" ");
        expect(readFileSync(mock.enrollLog, "utf8")).toContain(
          `${process.getuid?.()}|${expectedEnrollmentArgs}`,
        );
        const unit = readFileSync(
          path.join(mock.home, ".config/systemd/user/ssh-mcp-pro-agent.service"),
          "utf8",
        );
        expect(unit).toContain('ExecStart="' + process.execPath + '" "' + mock.agentBin + '" run');
        expect(unit).toContain(path.dirname(mock.agentBin));
        expect(readFileSync(mock.serviceLog, "utf8")).toBe(
          "--user daemon-reload\n--user enable ssh-mcp-pro-agent.service\n--user restart ssh-mcp-pro-agent.service\n",
        );
        expect(readFileSync(mock.serviceState, "utf8")).toBe("restarted\n");
      } finally {
        mock.cleanup();
      }
    });

    test("restarts a previously running user service after re-enrollment", () => {
      const mock = setupInstaller(true);
      try {
        writeFileSync(mock.serviceState, "running\n");
        const result = mock.run();
        expect(result.status).toBe(0);
        expect(readFileSync(mock.serviceState, "utf8")).toBe("restarted\n");
        const commands = readFileSync(mock.serviceLog, "utf8").trim().split("\n");
        expect(commands).toEqual([
          "--user daemon-reload",
          "--user enable ssh-mcp-pro-agent.service",
          "--user restart ssh-mcp-pro-agent.service",
        ]);
        expect(readFileSync(mock.enrollLog, "utf8")).toContain("enroll --server");
      } finally {
        mock.cleanup();
      }
    });

    test("rejects a missing npm global binary before enrollment or systemd", () => {
      const mock = setupInstaller(false);
      try {
        const result = mock.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("missing or not executable");
        expect(readFileSync(mock.installLog, "utf8")).toContain("installed");
        expect(() => readFileSync(mock.enrollLog, "utf8")).toThrow();
        expect(() => readFileSync(mock.serviceLog, "utf8")).toThrow();
      } finally {
        mock.cleanup();
      }
    });

    test("--system refuses non-root callers before npm install", () => {
      const mock = setupInstaller(true);
      try {
        const result = mock.run("--system");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("--system requires root");
        expect(() => readFileSync(mock.installLog, "utf8")).toThrow();
      } finally {
        mock.cleanup();
      }
    });

    test("does not trust user-managed npm prefixes for system installs", () => {
      const mock = setupInstaller(true);
      try {
        const source = readFileSync(script, "utf8");
        const start = source.indexOf("trusted_system_path() {");
        const end = source.indexOf('\n\nif [[ "$SCOPE" == "$SYSTEM_SCOPE" ]]; then', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const functionSource = source.slice(start, end);
        const result = spawnSync(
          "bash",
          ["-c", functionSource + '\ntrusted_system_path "$1"', "test", mock.root],
          { encoding: "utf8", timeout: 5_000 },
        );
        expect(result.status).toBe(1);
        const trusted = spawnSync(
          "bash",
          ["-c", functionSource + '\ntrusted_system_path "$1"', "test", "/usr/bin"],
          { encoding: "utf8", timeout: 5_000 },
        );
        expect(trusted.status).toBe(0);
        expect(source).toContain('trusted_system_path "$NODE_BIN"');
        expect(source).toContain('trusted_system_path "$NPM_BIN"');
        expect(source).toContain('trusted_system_path "$NPM_GLOBAL_PREFIX"');
      } finally {
        mock.cleanup();
      }
    });

    test("--system rejects a user-local runtime before any package installation", () => {
      const mock = setupInstaller(true);
      try {
        // Only Bash command lookup and id -u are stubbed; no real root process
        // and no npm install, enrollment, or systemd operation is performed.
        const isolatedProbe = path.join(mock.root, "preflight-probe.sh");
        stubFile(
          isolatedProbe,
          [
            'id() { if [[ "${1:-}" == "-u" ]]; then printf "0\\n"; else /usr/bin/id "$@"; fi; }',
            'command() { if [[ "${1:-}" == "-v" && "${2:-}" == "node" ]]; then printf "%s\\n" "$MOCK_NODE"; else builtin command "$@"; fi; }',
            "export -f id command",
            'exec /usr/bin/bash "$@"',
          ].join("\n"),
        );
        const result = spawnSync(
          "/usr/bin/bash",
          [
            isolatedProbe,
            script,
            "--server",
            "https://example.invalid",
            "--token",
            "placeholder",
            "--alias",
            "linux-test",
            "--system",
          ],
          {
            encoding: "utf8",
            timeout: 5_000,
            env: { ...mock.env, SUDO_USER: "root", MOCK_NODE: path.join(mock.root, "user-node") },
          },
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("--system needs root-owned system Node.js");
        expect(() => readFileSync(mock.installLog, "utf8")).toThrow();
        expect(() => readFileSync(mock.enrollLog, "utf8")).toThrow();
        expect(() => readFileSync(mock.serviceLog, "utf8")).toThrow();
      } finally {
        mock.cleanup();
      }
    });

    test("enrollment and systemd use the same system service identity", () => {
      const source = readFileSync(script, "utf8");
      expect(source).toContain('RUN_USER="${SUDO_USER:-root}"');
      expect(source).toContain('/usr/sbin/runuser -u "$RUN_USER"');
      expect(source).toContain('echo "User=${RUN_USER}"');
      expect(source).toContain("systemctl enable ssh-mcp-pro-agent.service");
      expect(source).toContain("systemctl restart ssh-mcp-pro-agent.service");
      expect(source).toContain("user service must not be installed as root");
    });
  },
);
