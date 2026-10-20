import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveExecutableOnPath } from "../../scripts/lib/resolve-executable.mjs";

const directories = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ssh-mcp-resolve-cli-"));
  directories.push(directory);
  return directory;
}
function executable(dir, name) {
  const file = join(dir, name);
  writeFileSync(file, "#!/bin/sh\\nexit 0\\n");
  chmodSync(file, 0o755);
  return file;
}
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("resolve the two trusted maintenance CLIs", () => {
  test.each(["gh", "ssh-mcp-pro"])("resolves %s directly to an absolute path", (name) => {
    const dir = fixture();
    const bin = executable(dir, name);
    expect(resolveExecutableOnPath(name, dir)).toBe(bin);
  });

  test("skips empty and relative entries, preserving valid PATH order", () => {
    const dir = fixture();
    const sub = join(dir, "bin");
    mkdirSync(sub);
    const bin = executable(sub, "gh");
    expect(resolveExecutableOnPath("gh", ["", "relative", sub].join(delimiter))).toBe(bin);
  });

  test("does not return non-executable candidates", () => {
    const dir = fixture();
    const bin = join(dir, "gh");
    writeFileSync(bin, "#!/bin/sh\\nexit 0\\n");
    chmodSync(bin, 0o644);
    expect(resolveExecutableOnPath("gh", dir)).toBeNull();
  });

  test.skipIf(process.platform === "win32")("skips world-writable PATH entries", () => {
    const unsafe = fixture();
    chmodSync(unsafe, 0o777);
    executable(unsafe, "gh");
    const safe = fixture();
    const preferred = executable(safe, "gh");
    expect(resolveExecutableOnPath("gh", [unsafe, safe].join(delimiter))).toBe(preferred);
  });

  test("accepts a standard executable symlink within a trusted directory", () => {
    const binDir = fixture();
    const target = executable(binDir, "original");
    symlinkSync(target, join(binDir, "ssh-mcp-pro"));
    expect(resolveExecutableOnPath("ssh-mcp-pro", binDir)).toBe(target);
  });

  test.skipIf(process.platform === "win32")(
    "rejects a symlink into a world-writable target directory",
    () => {
      const unsafe = fixture();
      chmodSync(unsafe, 0o777);
      const unsafeBinary = executable(unsafe, "gh");
      const safePath = fixture();
      symlinkSync(unsafeBinary, join(safePath, "gh"));
      const fallbackDir = fixture();
      const safeBinary = executable(fallbackDir, "gh");
      expect(resolveExecutableOnPath("gh", [safePath, fallbackDir].join(delimiter))).toBe(
        safeBinary,
      );
    },
  );

  test("rejects unexpected executable names", () => {
    expect(() => resolveExecutableOnPath("bash")).toThrow("Unsupported executable name");
  });

  test("returns null instead of spawning any tool when missing", () => {
    expect(resolveExecutableOnPath("gh", fixture())).toBeNull();
  });
});
