import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  capture,
  run,
  runCommand,
  commandFailure,
  executable,
} from "../../scripts/lib/command.mjs";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalPath = process.env.PATH;

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  process.env.PATH = originalPath;
});

describe("maintenance subprocess security boundaries", () => {
  test("executes node with argv rather than a shell", () => {
    const result = capture(process.execPath, ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^v\d+/u);
    expect(executable(process.execPath)).toBe(process.execPath);
  });

  test.each([{ shell: true }, { windowsVerbatimArguments: true }])(
    "rejects dangerous spawn options in capture and run",
    (options) => {
      expect(() => capture(process.execPath, ["--version"], options)).toThrow(
        "Refusing shell execution or verbatim Windows arguments",
      );
      expect(() => run(process.execPath, ["--version"], options)).toThrow(
        "Refusing shell execution or verbatim Windows arguments",
      );
      expect(() => runCommand(process.execPath, ["--version"], options)).toThrow(
        "Refusing shell execution or verbatim Windows arguments",
      );
    },
  );

  test.each(["bad;command", "bad&command", "bad|command", "bad$(command)", "bad\ncommand"])(
    "rejects shell metacharacters in subprocess argv %s",
    (value) => expect(() => capture(process.execPath, [value])).toThrow("shell metacharacters"),
  );

  test("reports subprocess failures without leaking credentials", () => {
    const result = capture(process.execPath, ["--not-a-node-option"]);
    expect(result.status).not.toBe(0);
    expect(commandFailure("node", result)).toEqual(
      expect.objectContaining({
        ok: false,
        status: expect.any(Number),
        error: expect.stringContaining("node failed"),
      }),
    );
  });

  test("rejects cmd.exe variable-expansion arguments for Windows shim fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssh-mcp-windows-shim-"));
    try {
      writeFileSync(join(dir, "pnpm.cmd"), "@echo off\r\n");
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      process.env.PATH = dir + ";";
      for (const arg of ["%COMSPEC%", "!TEMP!", "name^other", 'name"other', "<file"]) {
        expect(() => capture("pnpm", [arg])).toThrow("unsafe Windows command shim argument");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
