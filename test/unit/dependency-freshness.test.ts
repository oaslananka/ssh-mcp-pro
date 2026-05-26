import { describe, expect, test } from "vitest";

const moduleUrl = new URL("../../scripts/check-dependency-freshness.mjs", import.meta.url).href;
const freshness = await import(moduleUrl);

describe("dependency freshness helpers", () => {
  test("parses pinned package manager and Node engine floors", () => {
    expect(freshness.parsePackageManager("pnpm@11.0.9")).toEqual({
      name: "pnpm",
      version: "11.0.9",
    });

    expect(freshness.parseNodeEngineFloors("^22.22.2 || ^24.15.0")).toEqual([
      { major: 22, version: "22.22.2" },
      { major: 24, version: "24.15.0" },
    ]);
  });

  test("extracts root importer versions from pnpm lockfile text", () => {
    const lockText = [
      'lockfileVersion: "9.0"',
      "",
      "importers:",
      "  .:",
      "    dependencies:",
      '      "@scope/package":',
      "        specifier: ^1.2.3",
      "        version: 1.2.4(peer@1.0.0)",
      "      zod:",
      "        specifier: ^4.4.3",
      "        version: 4.4.3",
      "    devDependencies:",
      "      typescript:",
      "        specifier: ^5.9.3",
      "        version: 5.9.3",
      "",
      "packages:",
    ].join("\n");

    expect(Object.fromEntries(freshness.parseRootImporterVersions(lockText))).toEqual({
      "@scope/package": "1.2.4",
      typescript: "5.9.3",
      zod: "4.4.3",
    });
  });

  test("treats newer versions as advisory and deprecations as failures", () => {
    expect(freshness.statusForPackage("1.0.0", "1.1.0")).toMatchObject({
      status: "advisory",
    });
    expect(freshness.statusForPackage("1.0.0", "1.0.0")).toMatchObject({
      status: "pass",
    });
    expect(freshness.statusForPackage("1.0.0", "1.1.0", "use another package")).toMatchObject({
      status: "fail",
    });
  });

  test("classifies Node lifecycle phases against release schedule dates", () => {
    const schedule = {
      start: "2024-01-01",
      lts: "2024-10-01",
      maintenance: "2025-10-01",
      end: "2027-04-30",
    };

    expect(freshness.lifecycleForNode(schedule, "2024-06-01")).toMatchObject({
      phase: "current",
      status: "pass",
    });
    expect(freshness.lifecycleForNode(schedule, "2026-01-01")).toMatchObject({
      phase: "maintenance",
      status: "pass",
    });
    expect(freshness.lifecycleForNode(schedule, "2028-01-01")).toMatchObject({
      phase: "eol",
      status: "fail",
    });
  });
});
