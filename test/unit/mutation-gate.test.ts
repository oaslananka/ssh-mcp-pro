import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const extractLocalAllowedLicenses = () => {
  const script = read("scripts/check-licenses.mjs");
  const match = /allowedLicenses\s*=\s*new Set\(\[([\s\S]*?)\]\);/u.exec(script);

  if (!match?.[1]) {
    throw new Error("Unable to parse local allowed dependency licenses.");
  }

  return [...match[1].matchAll(/"([^"]+)"/gu)].map(([, license]) => license).sort();
};

const extractDependencyReviewLicenses = () => {
  const ci = read(".github/workflows/ci.yml");
  const match = /allow-licenses:\s*>-\n((?: {12}.+\n?)+)/u.exec(ci);

  if (!match?.[1]) {
    throw new Error("Unable to parse Dependency Review allowed licenses.");
  }

  return match[1]
    .split(",")
    .map((license) => license.trim())
    .filter(Boolean)
    .sort();
};

describe("mutation testing gate", () => {
  test("declares pinned Stryker tooling and runnable scripts", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(pkg.scripts["test:mutation"]).toBe("stryker run");
    expect(pkg.scripts["test:mutation:ci"]).toBe("stryker run");
    expect(pkg.devDependencies["@stryker-mutator/core"]).toBe("9.6.1");
    expect(pkg.devDependencies["@stryker-mutator/vitest-runner"]).toBe("9.6.1");
    expect(pkg.devDependencies["@stryker-mutator/typescript-checker"]).toBe("9.6.1");
  });

  test("keeps mutation scope focused on policy-critical modules", async () => {
    const configPath = path.join(repoRoot, "stryker.conf.mjs");

    expect(existsSync(configPath)).toBe(true);

    const configModule = (await import(
      `${pathToFileURL(configPath).href}?cacheBust=${Date.now()}`
    )) as {
      default: {
        testRunner: string;
        checkers: string[];
        mutate: string[];
        ignoreStatic: boolean;
        thresholds: { high: number; low: number; break: number | null };
        vitest: { configFile: string };
      };
    };

    expect(configModule.default).toMatchObject({
      testRunner: "vitest",
      checkers: ["typescript"],
      ignoreStatic: true,
      vitest: { configFile: "vitest.mutation.config.ts" },
      thresholds: { high: 80, low: 60, break: null },
    });
    const expectedRanges = [
      "src/auth.ts:38-42",
      "src/policy.ts:281-285",
      "src/policy.ts:293-297",
      "src/policy.ts:361-370",
      "src/policy.ts:404-405",
      "src/policy.ts:434-435",
      "src/policy.ts:457-458",
      "src/policy.ts:483-484",
      "src/policy.ts:496-500",
      "src/safety.ts:156-157",
      "src/config.ts:468-469",
      "src/session.ts:175-187",
      "src/session.ts:222-236",
      "src/http-security.ts:90-94",
      "src/oauth.ts:48-49",
      "src/oauth.ts:61-65",
      "src/remote/control-plane.ts:599-605",
      "src/remote/control-plane.ts:1163-1172",
      "src/remote/control-plane.ts:1264-1276",
      "src/remote/crypto.ts:176-184",
      "src/remote/policy.ts:92-100",
      "src/remote/policy.ts:102-107",
      "src/remote/scopes.ts:8-16",
      "src/remote/scopes.ts:28-32",
    ];

    expect(configModule.default.mutate).toEqual(expectedRanges);
    expect(
      configModule.default.mutate.every((target) => /^src\/.+\.ts:\d+-\d+$/u.test(target)),
    ).toBe(true);
    expect(configModule.default.mutate).not.toContain("src/policy.ts");
  });

  test("uses a dedicated mutation Vitest config without fixture-dependent projects", () => {
    const mutationConfig = read("vitest.mutation.config.ts");

    expect(mutationConfig).toContain("test/unit/policy*.test.ts");
    expect(mutationConfig).toContain("test/unit/remote-control-plane.test.ts");
    expect(mutationConfig).toContain("test/unit/auth.test.ts");
    expect(mutationConfig).not.toContain("test/perf");
    expect(mutationConfig).not.toContain("test/integration");
    expect(mutationConfig).not.toContain("test/e2e");
  });

  test("runs mutation testing as advisory scheduled/manual CI", () => {
    const ci = read(".github/workflows/ci.yml");

    expect(ci).toContain("mutation:");
    expect(ci).toContain("Mutation Tests (advisory)");
    expect(ci).toContain("github.event_name == 'schedule'");
    expect(ci).toContain("github.event_name == 'workflow_dispatch'");
    expect(ci).toContain("continue-on-error: true");
    expect(ci).toContain("pnpm run test:mutation:ci");
  });

  test("keeps Dependency Review license policy aligned with the local license gate", () => {
    expect(extractDependencyReviewLicenses()).toEqual(extractLocalAllowedLicenses());
  });

  test("documents promotion criteria and local validation", () => {
    const docs = read("docs/testing.md");

    expect(docs).toContain("Mutation testing");
    expect(docs).toContain("80%");
    expect(docs).toContain("advisory");
    expect(docs).toContain("pnpm run test:mutation");
    expect(docs).toContain("Windows 11 PowerShell");
  });
});
