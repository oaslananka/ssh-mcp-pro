import { describe, expect, test } from "vitest";
import {
  isValidCommitRange,
  isValidPackageName,
  parsePinnedPackageManager,
  stripLockPeerSuffix,
  splitLicenseExpression,
  parseEnvAssignment,
  hasMcpEndpointPath,
  findNodeEngineFloorVersions,
  nodeRuntimeStatus,
  mutationScoreSymbol,
  parseRootImporterVersions,
} from "../../scripts/lib/maintenance-cli-input.mjs";

describe("pure maintenance CLI input validation", () => {
  test.each(["ssh-mcp-pro", "@team/ssh-mcp-pro", "a", "abc._~-2"])(
    "allows valid npm identifier %s",
    (name) => expect(isValidPackageName(name)).toBe(true),
  );

  test.each([
    undefined,
    7,
    "",
    "@",
    "@scope",
    "@scope/",
    "@scope/name/other",
    "--registry",
    "../outside",
    "unsafe;command",
    "invalid💥",
    "_leading",
    "a".repeat(215),
  ])("rejects invalid npm identifier %s", (name) => {
    expect(isValidPackageName(name)).toBe(false);
  });

  test.each(["HEAD", "HEAD~1..HEAD", "origin/main..HEAD", "9fcef12", "v1.2.3^{commit}"])(
    "accepts valid Git revision %s",
    (range) => expect(isValidCommitRange(range)).toBe(true),
  );

  test.each([undefined, "", "-c", "--exec=echo", "HEAD;echo", "HEAD --all", "HEAD\nbad"])(
    "rejects Git option or unsafe revision %s",
    (range) => expect(isValidCommitRange(range)).toBe(false),
  );
});

describe("bounded maintenance-script parsers", () => {
  test.each([
    ["pnpm@11.0.9", { name: "pnpm", version: "11.0.9" }],
    ["yarn@1.22.0+sha256.abc", { name: "yarn", version: "1.22.0" }],
    ["npm@10.2.3.4", { name: "npm", version: "10.2.3" }],
    ["", undefined],
    ["pnpm", undefined],
    ["@1.2.3", undefined],
    ["pnpm@12.2", undefined],
    ["pnpm@foo", undefined],
  ])("parses pinned package manager %s", (input, output) => {
    expect(parsePinnedPackageManager(input)).toEqual(output);
  });

  test("rejects long malformed package manager version", () => {
    expect(parsePinnedPackageManager("pnpm@1." + "2".repeat(40000))).toBeUndefined();
  });

  test.each([
    ['"1.2.3(peer@2.0.0)"', "1.2.3"],
    ["1.2.3(peer@2.0.0)", "1.2.3"],
    ["1.2.3(", "1.2.3("],
    ["1.2.3", "1.2.3"],
    ['"1.2.3"', "1.2.3"],
    [" 1.2.3(peer@4)", "1.2.3"],
  ])("strips lock peer suffix %s", (input, output) => {
    expect(stripLockPeerSuffix(input)).toBe(output);
  });

  test.each([
    ["MIT OR Apache-2.0", ["MIT", "Apache-2.0"]],
    ["MIT AND ISC", ["MIT", "ISC"]],
    ["MIT / Apache-2.0", ["MIT ", " Apache-2.0"]],
    ["MIT/Apache-2.0", ["MIT", "Apache-2.0"]],
    ["MIT	OR	ISC", ["MIT", "ISC"]],
    ["MIT ORISC", ["MIT ORISC"]],
    ["MIT (OR) ISC", ["MIT (OR) ISC"]],
    ["MIT", ["MIT"]],
  ])("splits license expression %s", (input, output) => {
    expect(splitLicenseExpression(input)).toEqual(output);
  });

  test("scans long license whitespace runs without superlinear backtracking", () => {
    const long = " ".repeat(40_000);
    expect(splitLicenseExpression("MIT" + long + "OR" + long + "ISC")).toEqual(["MIT", "ISC"]);
    expect(splitLicenseExpression("MIT" + long + "ORnot")).toEqual(["MIT" + long + "ORnot"]);
  });

  test.each([
    ["KEY=value", { key: "KEY", value: "value" }],
    ["   export   TOKEN = abc  ", { key: "TOKEN", value: "abc  " }],
    ["export=not-a-keyword", { key: "export", value: "not-a-keyword" }],
    ["export FOO=", { key: "FOO", value: "" }],
    ["_FOO_1  =   yes", { key: "_FOO_1", value: "yes" }],
    ["NO_EQUALS", undefined],
    ["1INVALID=abc", undefined],
    ["export = val", { key: "export", value: "val" }],
    ["export 1FOO=abc", undefined],
    [" KEY - invalid=value", undefined],
  ])("parses env assignment %s", (input, output) => {
    expect(parseEnvAssignment(input)).toEqual(output);
  });

  test("handles large env assignments without backtracking", () => {
    const value = "x".repeat(40_000) + "  ";
    expect(parseEnvAssignment(" export KEY = " + value)).toEqual({
      key: "KEY",
      value,
    });
  });

  test.each([
    ["/mcp", true],
    ["/mcp/", true],
    ["/mcp/////", true],
    ["/mcp-other/////", false],
    ["/mcp/a", false],
    ["/", false],
    ["/////", false],
    ["", false],
  ])("matches exact MCP endpoint %s", (path, expected) => {
    expect(hasMcpEndpointPath(path)).toBe(expected);
  });
});

describe("bounded Node engine version scanner", () => {
  test.each([
    ["^22.22.2 || ^24.15.0", ["22.22.2", "24.15.0"]],
    ["node >=20.1.0 <=22.1.9", ["20.1.0", "22.1.9"]],
    ["1.2.3.4", ["1.2.3"]],
    ["^1.2.3-rc.1", ["1.2.3"]],
    ["foo1.2.3bar", ["1.2.3"]],
    ["1..2.3.4", ["2.3.4"]],
    ["^a1.2.3", ["1.2.3"]],
    ["", []],
    ["22.22", []],
    ["23.4.foo", []],
  ])("extracts numeric version triples from %s", (value, output) => {
    expect(findNodeEngineFloorVersions(value)).toEqual(output);
  });

  test("rejects long unmatched digit runs with linear scanning", () => {
    const long = "8".repeat(40_000);
    expect(findNodeEngineFloorVersions(long + "x 24.15.0")).toEqual(["24.15.0"]);
    expect(findNodeEngineFloorVersions("^22." + long + ".24")).toEqual(["22." + long + ".24"]);
  });
});

describe("maintenance report classification", () => {
  test.each([
    [{ status: "fail" }, true, "fail"],
    [{ status: "fail" }, false, "fail"],
    [{ status: "pass" }, true, "advisory"],
    [{ status: "pass" }, false, "pass"],
    [{ status: "pass" }, undefined, "pass"],
  ])("preserves lifecycle precedence for %j and %s", (lifecycle, newer, expected) => {
    expect(nodeRuntimeStatus(lifecycle, newer)).toBe(expected);
  });

  test.each([
    [100, "✅"],
    [80, "✅"],
    [79.9, "⚠️"],
    [60, "⚠️"],
    [59.9, "❌"],
    [0, "❌"],
    [Number.NaN, "❌"],
  ])("formats mutation score band for %s", (score, expected) => {
    expect(mutationScoreSymbol(score)).toBe(expected);
  });
});

describe("covered pnpm root importer parser", () => {
  test("ignores package records outside the root importer", () => {
    const input = [
      "importers:",
      "  other:",
      "    dependencies:",
      "      should-not-match:",
      "        version: 1.2.3",
      "packages:",
    ].join("\n");
    expect([...parseRootImporterVersions(input)]).toEqual([]);
  });

  test("preserves quoted package names, peer suffixes, and root section boundaries", () => {
    const input = [
      "importers:",
      "  .:",
      "    dependencies:",
      "      '@scope/lib':",
      "        version: 2.1.0(peer@3.0.0)",
      '      "double-quoted":',
      "        version: 3.4.5",
      "    devDependencies:",
      "      eslint:",
      '        version: "9.0.1"',
      "  next:",
      "    dependencies:",
      "      ignored:",
      "        version: 9.9.9",
    ].join("\n");
    expect(Object.fromEntries(parseRootImporterVersions(input))).toEqual({
      "@scope/lib": "2.1.0",
      "double-quoted": "3.4.5",
      eslint: "9.0.1",
    });
  });

  test("ignores unrecognized lockfile sections and missing package identifiers", () => {
    const input = [
      "importers:",
      "  .:",
      "    dependencies:",
      "        version: orphan",
      "      valid:",
      "        version: 1.2.3",
      "    optionalDependencies:",
      "      optional:",
      "        version: 4.0.0",
    ].join("\n");
    const result = parseRootImporterVersions(input);
    expect(result.get("valid")).toBe("1.2.3");
  });
});
