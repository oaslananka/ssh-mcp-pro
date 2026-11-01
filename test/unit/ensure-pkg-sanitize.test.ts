import { describe, expect, test } from "vitest";
import { getPackageCheckCommand, sanitizePackageName } from "../../src/ensure-pkg.js";

describe("package name input validation", () => {
  test.each(["openssh-server", "curl", "nodejs_22", "pkg+feature", "libssl3.0"])(
    "accepts a package name from the existing allowlist: %s",
    (name) => {
      expect(sanitizePackageName(name)).toBe(name);
    },
  );

  test("preserves winget command regex escaping for literal package IDs", () => {
    const command = getPackageCheckCommand("winget", "lib+name");
    expect(command).toContain(String.raw`'(^|\s)lib\+name(\s|$)'`);
    expect(command).toContain("winget list --id 'lib+name' --exact");
  });

  test.each([
    "",
    "-bad",
    "x;echo",
    "x & y",
    "x|cat",
    "x$HOME",
    "x[0]",
    "x\\y",
    'x"quoted',
    "x'quoted",
    "x\n",
    "x\r",
  ])("rejects invalid characters or prefixes: %j", (name) => {
    expect(() => sanitizePackageName(name)).toThrow("Invalid package name");
  });
});
