import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AgentActivityLog,
  agentActivityLogPath,
  readAgentActivity,
} from "../../src/remote/agent-activity-log.js";

const temporaryDirs: string[] = [];
afterEach(() => {
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
