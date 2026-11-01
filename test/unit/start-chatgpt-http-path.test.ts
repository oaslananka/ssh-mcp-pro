import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const startupScript = resolve("scripts/start-chatgpt-http.mjs");
const fixtures: string[] = [];

function tempDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "ssh-mcp-start-env-path-"));
  fixtures.push(dir);
  return dir;
}

function invoke(cwd: string, envPath: string) {
  return spawnSync(process.execPath, [startupScript, envPath], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, SSH_MCP_HTTP_PUBLIC_URL: "" },
  });
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ChatGPT HTTP startup env-file confinement", () => {
  test("rejects an absolute path outside the current working directory", () => {
    const cwd = tempDirectory();
    const external = tempDirectory();
    const secretPath = join(external, "outside.env");
    writeFileSync(secretPath, "SSH_MCP_HTTP_PUBLIC_URL=https://malicious.example/mcp\n");
    const result = invoke(cwd, secretPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("env file path is outside the working directory");
    expect(result.stderr).not.toContain("malicious.example");
  });

  test("rejects a symlink within cwd that resolves outside cwd", () => {
    const cwd = tempDirectory();
    const external = tempDirectory();
    const secretPath = join(external, "outside.env");
    writeFileSync(secretPath, "SSH_MCP_HTTP_PUBLIC_URL=https://malicious.example/mcp\n");
    const linkedPath = join(cwd, ".env");
    symlinkSync(secretPath, linkedPath);
    const result = invoke(cwd, linkedPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("env file path is outside the working directory");
    expect(result.stderr).not.toContain("malicious.example");
  });

  test("reads an in-tree env-file alias after canonical path checks", () => {
    const cwd = tempDirectory();
    const safePath = join(cwd, "valid.env");
    writeFileSync(safePath, "# valid but incomplete configuration\n");
    const alias = join(cwd, ".env");
    symlinkSync(safePath, alias);
    const result = invoke(cwd, alias);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SSH_MCP_HTTP_PUBLIC_URL is required");
    expect(result.stderr).not.toContain("outside the working directory");
  });
});
