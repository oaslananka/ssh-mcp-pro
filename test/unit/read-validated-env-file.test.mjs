import { mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
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
    expect(readValidatedEnvFile(openSync(path, "r"), path)).toBe("SSH_MCP_TOOL_PROFILE=chatgpt\n");
  });

  test.skipIf(process.platform === "win32")("refuses a non-regular file", () => {
    const path = fixtureDir();
    expect(() => readValidatedEnvFile(openSync(path, "r"), path)).toThrow("regular file");
  });
});
