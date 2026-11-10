import { describe, expect, test } from "vitest";
import { buildDashboardEnrollmentCommands } from "../../src/remote/dashboard-enrollment-commands.js";

describe("dashboard agent enrollment commands", () => {
  test("preserves Linux, PowerShell and npm installation contracts", () => {
    const commands = buildDashboardEnrollmentCommands(
      "https://example.test",
      "enroll_token",
      "device-main",
    );
    expect(commands.linux).toContain("bash -o pipefail -c");
    expect(commands.linux).toContain("install-agent.sh");
    expect(commands.windows).toContain("install-agent.ps1");
    expect(commands.windows).toContain("[scriptblock]::Create");
    expect(commands.npm).toContain("ssh-mcp-pro-agent enroll");
    expect(commands.npm).toContain("ssh-mcp-pro-agent run");
    for (const command of Object.values(commands)) {
      expect(command).toContain("enroll_token");
      expect(command).toContain("device-main");
    }
  });

  test("escapes apostrophes independently for shell and PowerShell", () => {
    const commands = buildDashboardEnrollmentCommands(
      "https://example.test",
      "token-value",
      "host's name",
    );
    expect(commands.linux).toContain(String.raw`'host'\''s name'`);
    expect(commands.windows).toContain("'host''s name'");
    expect(commands.npm).toContain(String.raw`'host'\''s name'`);
  });
});
