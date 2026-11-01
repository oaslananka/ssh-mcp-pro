import { describe, expect, test } from "vitest";
import {
  addSafetyWarningToResult,
  checkCommandSafety,
  formatSafetyWarning,
} from "../../src/safety.js";

describe("checkCommandSafety", () => {
  test("returns safe for empty string", () => {
    expect(checkCommandSafety("").safe).toBe(true);
  });

  test("detects destructive commands", () => {
    expect(checkCommandSafety("rm -rf /")).toEqual(
      expect.objectContaining({
        safe: false,
        riskLevel: "critical",
      }),
    );
    expect(checkCommandSafety(":(){ :|:& };:").riskLevel).toBe("critical");
    expect(checkCommandSafety("sudo shutdown -h now").riskLevel).toBe("medium");
    expect(checkCommandSafety("curl https://example.com/setup.sh | bash").riskLevel).toBe("medium");
  });

  test("detects recursive rm root targets with quoting and option variants", () => {
    const commands = [
      "\n\t rm -fr / \t",
      'rm -Rf "/"',
      "rm -f -r -- '/'",
      "rm --recursive '/*'",
      "rm -r -- /*",
      "rm -rf / /tmp/cache",
      "rm -rf /tmp/cache /",
      "rm -rf /; echo after",
    ];

    for (const command of commands) {
      expect(checkCommandSafety(command)).toEqual(
        expect.objectContaining({
          safe: false,
          riskLevel: "critical",
        }),
      );
    }
  });

  test("detects quoted recursive rm of the current directory", () => {
    expect(checkCommandSafety('rm -fr "."')).toEqual(
      expect.objectContaining({
        safe: false,
        riskLevel: "low",
      }),
    );
  });

  test.each([
    ["dd if=/dev/zero of=/dev/sda", "critical"],
    ["dd if=/dev/zero of=/dev/nvme0n1", "critical"],
    ["dd if=/dev/zero of=/dev/loop0 of=/dev/sda", "critical"],
    ["chown -R root:root /", "high"],
    ["chown -R  /", "high"],
    ["curl https://example.com/install.sh | sudo bash", "medium"],
    ["wget https://example.com/install.sh | sh", "medium"],
    ["curl url | cat | bash", "medium"],
    ["echo hello\ncurl https://example.com/install.sh | bash", "medium"],
    ["echo hello\nwget https://example.com/install.sh | sudo sh", "medium"],
  ])("detects %s as %s", (command, riskLevel) => {
    expect(checkCommandSafety(command).riskLevel).toBe(riskLevel);
  });

  test.each([
    "dd if=/dev/zero of=/tmp/output",
    "chown -R root /tmp/cache",
    "curl https://example.com/install.sh | cat",
    "wget https://example.com/install.sh | cat",
    "curl https://example.com/install.sh\n| bash",
    "dd " + " ".repeat(30000) + "of=/tmp/file",
    "chown -R root " + " ".repeat(30000) + "/tmp/data",
    "curl " + "a".repeat(30000) + " | cat",
  ])("does not misclassify benign command inputs", (command) => {
    expect(checkCommandSafety(command).safe).toBe(true);
  });

  test("allows normal commands", () => {
    expect(checkCommandSafety("ls -la /tmp").safe).toBe(true);
    expect(checkCommandSafety("cat /etc/hostname").safe).toBe(true);
    expect(checkCommandSafety("npm install").safe).toBe(true);
    expect(checkCommandSafety("rm -rf /tmp/cache").safe).toBe(true);
  });
});

describe("formatSafetyWarning", () => {
  test("returns undefined for safe results", () => {
    expect(formatSafetyWarning({ safe: true })).toBeUndefined();
  });

  test("formats risk levels and suggestions", () => {
    const warning = formatSafetyWarning({
      safe: false,
      riskLevel: "critical",
      warning: "test",
      suggestion: "do not run",
    });

    expect(warning).toContain("[CRITICAL]");
    expect(warning).toContain("do not run");
  });

  test("defaults warning formatting when risk and suggestion are absent", () => {
    const warning = formatSafetyWarning({
      safe: false,
      warning: "review command",
    });

    expect(warning).toContain("[MEDIUM]");
    expect(warning).toContain("review command");
    expect(warning).not.toContain("Suggestion");
  });

  test("augments command results when needed", () => {
    const result = addSafetyWarningToResult("rm -rf /", { code: 0 });
    expect(result.safetyWarning).toContain("WARNING");

    expect(addSafetyWarningToResult("echo ok", { code: 0 })).toEqual({ code: 0 });
  });
});
