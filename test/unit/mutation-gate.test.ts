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
    expect(pkg.devDependencies["@stryker-mutator/core"]).toBe("10.1.1");
    expect(pkg.devDependencies["@stryker-mutator/vitest-runner"]).toBe("10.1.1");
    expect(pkg.devDependencies["@stryker-mutator/typescript-checker"]).toBe("10.1.1");
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
    expect(configModule.default.mutate).toHaveLength(24);
    const selected = configModule.default.mutate.map((target) => {
      const match = /^([^:]+):(\d+)-(\d+)$/u.exec(target);
      if (!match?.[1] || !match[2] || !match[3]) throw new Error("Invalid range: " + target);
      const first = Number(match[2]);
      const last = Number(match[3]);
      const lines = read(match[1]).split(/\r?\n/u);
      expect(first).toBeGreaterThan(0);
      expect(last).toBeGreaterThanOrEqual(first);
      expect(last).toBeLessThanOrEqual(lines.length);
      expect(last - first + 1).toBeLessThanOrEqual(20);
      return { file: match[1], source: lines.slice(first - 1, last).join("\n") };
    });
    expect(new Set(configModule.default.mutate).size).toBe(24);
    const criticalTargets = [
      ["src/policy.ts", "!this.config.allowRootLogin"],
      ["src/policy.ts", "!this.config.allowRawSudo"],
      ["src/policy.ts", "!this.config.allowDestructiveCommands"],
      ["src/policy.ts", "this.config.tunnelDenyBindHosts"],
      ["src/policy.ts", "this.config.tunnelAllowBindHosts"],
      ["src/policy.ts", "this.localPathDenyPrefixes.some"],
      ["src/policy.ts", "this.pathDenyPrefixes.some"],
      ["src/session-connection-config.ts", "this.verifyKnownHostKey("],
      ["src/http-security.ts", '!== "strict"'],
      ["src/remote/control-plane-agent-operations.ts", 'status: "revoked"'],
      ["src/remote/control-plane-agent-operations.ts", "?.value !== true"],
      ["src/remote/control-plane-agent-operations.ts", "Copy requires files.read and files.write"],
      ["src/remote/crypto.ts", 'algorithms: ["EdDSA"]'],
      ["src/remote/policy.ts", "policy.denyPaths.some"],
      ["src/remote/policy.ts", "policy.allowPaths.some"],
    ];
    for (const [file, anchor] of criticalTargets) {
      expect(
        selected.some((range) => range.file === file && range.source.includes(anchor ?? "")),
        file + ": " + anchor,
      ).toBe(true);
    }
    expect(configModule.default.mutate).not.toContain("src/policy.ts");
  });

  test("resolves source anchors after line shifts and rejects missing or ambiguous anchors", async () => {
    const configPath = path.join(repoRoot, "stryker.conf.mjs");
    const { resolveMutationRange } = (await import(pathToFileURL(configPath).href)) as {
      resolveMutationRange: (file: string, source: string, anchor: string) => string;
    };
    const file = "src/fixture.ts";
    const snippet = "if (!allowed) {\nreturn false;";
    expect(resolveMutationRange(file, "if (!allowed) {\n  return false;\n}", snippet)).toBe(
      file + ":1-2",
    );
    expect(
      resolveMutationRange(
        file,
        "// inserted\r\n  if (!allowed) {\r\n    return false;\r\n}",
        snippet,
      ),
    ).toBe(file + ":2-3");
    expect(() => resolveMutationRange(file, "return true;", snippet)).toThrow("exactly one");
    expect(() => resolveMutationRange(file, snippet + "\n" + snippet, snippet)).toThrow(
      "exactly one",
    );
    expect(() => resolveMutationRange(file, "", "")).toThrow("bounded");
    expect(() => resolveMutationRange(file, "x\n".repeat(21), "x\n".repeat(21).trimEnd())).toThrow(
      "bounded",
    );
  });

  test("uses a dedicated mutation Vitest config without fixture-dependent projects", () => {
    const mutationConfig = read("vitest.mutation.config.ts");

    expect(mutationConfig).toContain("test/unit/policy*.test.ts");
    expect(mutationConfig).toContain("test/unit/remote-control-plane.test.ts");
    expect(mutationConfig).toContain("test/unit/auth.test.ts");
    expect(mutationConfig).toContain("test/unit/session-connection-config.test.ts");
    expect(mutationConfig).not.toContain("test/unit/mutation-gate.test.ts");
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
