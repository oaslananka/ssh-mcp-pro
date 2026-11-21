import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AgentActivityLog,
  agentActivityLogPath,
  readAgentActivity,
} from "../../src/remote/agent-activity-log.js";

const temporaryDirs: string[] = [];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  delete process.env.SSHAUTOMATOR_AGENT_LOG_DETAIL;
  delete process.env.SSHAUTOMATOR_AGENT_LOG_COMMANDS;
  delete process.env.SSHAUTOMATOR_AGENT_LOG_OUTPUT;
});

afterEach(() => {
  process.env = savedEnv;
  vi.restoreAllMocks();
  for (const folder of temporaryDirs.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function testConfigPath() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-activity-"));
  temporaryDirs.push(dir);
  return path.join(dir, "agent.json");
}

describe("outbound agent activity diagnostics", () => {
  test("renders a bounded, useful terminal panel and saves structured events", () => {
    const config = testConfigPath();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    activity.banner("test-agent", "read-only", 3);
    activity.event("info", "transport_open", "Transport open. Validating agent identity.");
    activity.event("ok", "agent_ready", "Identity confirmed. Agent ready for requests.");
    activity.event("warn", "action_expired", "Expired action ignored.");
    expect(stdout).toHaveBeenCalled();
    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("OUTBOUND AGENT ACTIVITY");
    expect(output).toContain("STATUS   CONNECTING");
    expect(output).toContain("Policy v3");
    expect(output).toContain("logs --follow");
    expect(output).toContain("Agent ready for requests");
    const file = agentActivityLogPath(config);
    expect(file).toContain("logs");
    const events = readAgentActivity(config);
    expect(events).toHaveLength(3);
    expect(events.map((entry) => entry.event)).toEqual([
      "transport_open",
      "agent_ready",
      "action_expired",
    ]);
    expect(events[0]).toMatchObject({
      level: "info",
      message: "Transport open. Validating agent identity.",
    });
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  test("shows actionable request names, safe command details and a correlated completion", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    activity.actionStarted({
      action_id: "act_d3e8c04b9e77",
      tool: "run_shell",
      args: { command: "git status -sb", cwd: "/home/user/work" },
    });
    activity.actionFinished(
      { action_id: "act_d3e8c04b9e77", tool: "run_shell", args: {} },
      { status: "ok", exit_code: 0, stdout: "## main\n M file.ts\n", stderr: "", truncated: false },
      842,
    );
    const printed = writes.mock.calls.map((call) => String(call[0])).join("");
    expect(printed).toContain("RUN_SHELL");
    expect(printed).toContain("git status -sb");
    expect(printed).toContain("d3e8c04b");
    expect(printed).toContain("842 ms");
    expect(printed).toContain("exit=0");
    expect(printed).toContain("2 lines");
    const events = readAgentActivity(config);
    expect(events.map((item) => item.event)).toEqual(["action_started", "action_finished"]);
    expect(events.map((item) => item.message).join(" ")).not.toContain("/home/user/work");
  });

  test("never persists raw shell commands, stdout or secret-bearing file paths", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    const action = {
      action_id: "act_12345678",
      tool: "run_shell",
      args: {
        command:
          'curl -H "Authorization: Bearer supersecret" https://service.example/?token=topsecret',
        cwd: "/home/user/private",
      },
    };
    activity.actionStarted(action);
    activity.actionFinished(
      action,
      {
        status: "error",
        error_code: "COMMAND_TIMEOUT",
        exit_code: 1,
        stdout: "another-secret-string",
        stderr: "more-password-here",
        truncated: true,
      },
      77,
    );
    activity.actionStarted({
      action_id: "act_23456789",
      tool: "file_replace",
      args: {
        path: "/home/user/secrets/token-file.txt",
        old_text: "hidden",
        new_text: "hidden-new",
      },
    });
    const printed = writes.mock.calls.map((call) => String(call[0])).join("");
    const persisted = readFileSync(agentActivityLogPath(config), "utf8");
    for (const leaked of [
      "supersecret",
      "topsecret",
      "another-secret-string",
      "more-password-here",
      "hidden-new",
      "/home/user/private",
      "/home/user/secrets",
    ]) {
      expect(printed).not.toContain(leaked);
      expect(persisted).not.toContain(leaked);
    }
    expect(printed).toContain("RUN_SHELL");
    expect(printed).toContain("COMMAND_TIMEOUT");
    expect(printed).toContain("FILE_REPLACE");
  });

  test("verbose mode shows bounded diagnostics without persisting console-only previews", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config, { detail: "verbose", showCommands: true });
    const command = "curl --token=supersecret https://example.test/?password=hunter2";
    activity.actionStarted({
      action_id: "act_a1b2c3d4",
      tool: "run_shell",
      args: { command, cwd: "/workspace/project" },
    });
    activity.actionFinished(
      {
        action_id: "act_a1b2c3d4",
        tool: "run_shell",
        args: {},
      },
      {
        status: "ok",
        exit_code: 0,
        stdout: "very-private-output",
        stderr: "",
        truncated: false,
      },
      1234,
    );
    const printed = writes.mock.calls.map((call) => String(call[0])).join("");
    expect(printed).toContain("command:");
    expect(printed).toContain("[REDACTED]");
    expect(printed).toContain("cwd:");
    expect(printed).toContain("1.23 s");
    expect(printed).not.toContain("supersecret");
    expect(printed).not.toContain("hunter2");
    expect(printed).not.toContain("very-private-output");
    const persisted = readFileSync(agentActivityLogPath(config), "utf8");
    expect(persisted).not.toContain("curl");
    expect(persisted).not.toContain("workspace/project");
    expect(persisted).not.toContain("very-private-output");
  });

  test("shows nonzero command exit as a warning even if transport delivery succeeded", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    activity.actionFinished(
      { action_id: "act_4f5a6b7c", tool: "run_shell", args: {} },
      { status: "ok", exit_code: 2, stdout: "", stderr: "not found", truncated: false },
      21,
    );
    const output = writes.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("WARN");
    expect(output).toContain("exit=2");
    expect(readAgentActivity(config)[0]?.level).toBe("warn");
  });

  test("opt-in output preview is console-only, bounded and redacted", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config, {
      detail: "verbose",
      showOutput: true,
    });
    const action = {
      action_id: "act_11223344",
      tool: "run_shell",
      args: { command: "git status" },
    };
    activity.actionFinished(
      action,
      {
        status: "error",
        error_code: "POLICY_DENIED",
        exit_code: 9,
        stdout: "token=topsecret\nready",
        stderr: "password=hunter2",
        truncated: false,
      },
      99,
    );
    const output = writes.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("stdout preview:");
    expect(output).toContain("stderr preview:");
    expect(output).toContain("ready");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("topsecret");
    expect(output).not.toContain("hunter2");
    const persisted = readFileSync(agentActivityLogPath(config), "utf8");
    expect(persisted).not.toContain("ready");
    expect(persisted).not.toContain("topsecret");
    expect(persisted).not.toContain("hunter2");
  });

  test("correlates process reads with a safe short process identifier", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    activity.actionStarted({
      action_id: "act_01234567",
      tool: "process_read",
      args: { process_id: "8e7f6a5b-0000-0000-0000-123456789012", cursor: 12 },
    });
    const output = writes.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("PROCESS_READ");
    expect(output).toContain("8e7f6a5b");
    expect(output).not.toContain("123456789012");
  });

  test("distinguishes file replacement preview from apply and reports process-read progress", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    activity.actionStarted({
      action_id: "act_abc12340",
      tool: "file_replace",
      args: {
        path: "C:\\projects\\agent.ts",
        dry_run: true,
        old_text: "secret",
        new_text: "secret2",
      },
    });
    activity.actionStarted({
      action_id: "act_abc12341",
      tool: "file_replace",
      args: {
        path: "C:\\projects\\agent.ts",
        dry_run: false,
        old_text: "secret",
        new_text: "secret2",
      },
    });
    const action = {
      action_id: "act_abc12342",
      tool: "process_read",
      args: { process_id: "8e7f6a5b-0000-0000-0000-123456789012" },
    };
    activity.actionFinished(
      action,
      {
        status: "ok",
        exit_code: 0,
        truncated: false,
        stderr: "",
        stdout: JSON.stringify({
          status: "running",
          next_cursor: 5,
          chunks: [{ stream: "stdout", text: "private-contents" }],
        }),
      },
      5,
    );
    const output = writes.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("PREVIEW agent.ts");
    expect(output).toContain("APPLY agent.ts");
    expect(output).toContain("chunks=1");
    expect(output).toContain("cursor=5");
    expect(output).toContain("running");
    expect(output).not.toContain("private-contents");
    expect(readFileSync(agentActivityLogPath(config), "utf8")).not.toContain("private-contents");
  });

  test("keeps the startup terminal panel consistently aligned", () => {
    const config = testConfigPath();
    const writes = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config);
    activity.banner("test-device", "operations", 3);
    const text = writes.mock.calls.map((call) => String(call[0])).join("");
    const rows = text.split("\n").filter((line) => line.startsWith("│"));
    expect(rows).toHaveLength(5);
    expect(rows.every((line) => [...line].length === 59)).toBe(true);
  });

  test("rotates large event files without growing unbounded or losing recent events", () => {
    const config = testConfigPath();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const activity = new AgentActivityLog(config, { maxBytes: 240, maxArchives: 2 });
    for (let i = 0; i < 35; i++) {
      activity.event("info", "cycle", "Cycle " + i + " completed without request arguments");
    }
    const file = agentActivityLogPath(config);
    const previous = readFileSync(file + ".1", "utf8");
    const older = readFileSync(file + ".2", "utf8");
    expect(previous.length).toBeGreaterThan(0);
    expect(previous.length).toBeLessThan(512);
    expect(older.length).toBeGreaterThan(0);
    expect(readAgentActivity(config, 3).at(-1)?.message).toContain("Cycle 34");
    expect(previous + older).not.toContain("password");
  });

  test("rejects excessive history requests and treats missing log as empty", () => {
    const config = testConfigPath();
    expect(readAgentActivity(config)).toEqual([]);
    expect(() => readAgentActivity(config, 201)).toThrow("--tail");
    expect(() => readAgentActivity(config, 0)).toThrow("--tail");
  });
});
