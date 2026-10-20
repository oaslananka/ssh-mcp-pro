import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readValidatedEnvFile } from "../../scripts/lib/read-validated-env-file.mjs";

const fixtures = [];
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "ssh-validated-env-"));
  fixtures.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readValidatedEnvFile", () => {
  test("returns the contents of a regular file", () => {
    const path = join(fixtureDir(), ".env");
    writeFileSync(path, "SSH_MCP_TOOL_PROFILE=chatgpt\n");
    expect(readValidatedEnvFile(path)).toBe("SSH_MCP_TOOL_PROFILE=chatgpt\n");
  });

  test("refuses a non-regular file", () => {
    expect(() => readValidatedEnvFile(fixtureDir())).toThrow();
  });
});
