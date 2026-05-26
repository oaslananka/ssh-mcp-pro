import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runNodeScript(script: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("release scripts", () => {
  it("validates the Release Please configuration", () => {
    const result = runNodeScript("scripts/validate-release-please.mjs");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("release configuration is ready");
  });

  it("reports offline release state as JSON", () => {
    const result = runNodeScript("scripts/release-state.mjs", ["--offline", "--json"]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const state = JSON.parse(result.stdout) as {
      package: { name: string };
      trustedPublishing: { environment: string; allowedAction: string };
      workflow: { hasOidcPermission: boolean; usesNpmPublish: boolean };
    };

    expect(state.package.name).toBe("ssh-mcp-pro");
    expect(state.trustedPublishing.environment).toBe("npm-production");
    expect(state.trustedPublishing.allowedAction).toBe("npm publish");
    expect(state.workflow.hasOidcPermission).toBe(true);
    expect(state.workflow.usesNpmPublish).toBe(true);
  });
});
