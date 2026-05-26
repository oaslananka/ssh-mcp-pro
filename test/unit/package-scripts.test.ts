import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const allowedPendingScripts = new Set([
  "scripts/release-state.mjs",
  "scripts/validate-release-please.mjs",
]);
const removedScripts = ["dev:agent", "dev:control-plane", "setup:chatgpt"] as const;

interface PackageJson {
  readonly scripts: Record<string, string>;
}

function readText(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readPackageJson() {
  return JSON.parse(readText("package.json")) as PackageJson;
}

function nodeScriptTargets(command: string) {
  return [...command.matchAll(/\bnode\s+(scripts\/[^\s"'&|;]+\.mjs)\b/gu)].map((match) => match[1]);
}

describe("package script entrypoints", () => {
  test("resolve retained node script helpers", () => {
    const packageJson = readPackageJson();
    const missing = Object.entries(packageJson.scripts).flatMap(([name, command]) =>
      nodeScriptTargets(command)
        .filter((target) => !allowedPendingScripts.has(target))
        .filter((target) => !fs.existsSync(path.join(repoRoot, target)))
        .map((target) => `${name}: ${target}`),
    );

    expect(missing).toEqual([]);
  });

  test("remove obsolete undocumented helper commands", () => {
    const packageJson = readPackageJson();
    const contributing = readText("CONTRIBUTING.md");

    for (const scriptName of removedScripts) {
      expect(packageJson.scripts[scriptName]).toBeUndefined();
      expect(contributing).not.toContain(`pnpm run ${scriptName}`);
    }
  });
});
