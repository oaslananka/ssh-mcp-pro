import { readFileSync } from "node:fs";

// Resolve exact, contiguous source anchors rather than stale absolute line numbers.
// Formatting indentation and CRLF differences do not affect the selected range.
export function resolveMutationRange(file, source, anchor) {
  const needle = anchor
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim());
  if (needle.length > 20 || !needle.some(Boolean)) {
    throw new Error("Mutation anchor must be nonempty and bounded: " + file);
  }
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  const matches = [];
  for (let index = 0; index <= lines.length - needle.length; index++) {
    if (needle.every((line, offset) => lines[index + offset] === line)) {
      matches.push(index + 1);
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      "Mutation anchor must match exactly one location: " +
        file +
        " (" +
        needle[0] +
        "), found " +
        matches.length,
    );
  }
  return file + ":" + matches[0] + "-" + (matches[0] + needle.length - 1);
}

// Mutation commands run from the repository root, just like tsconfigFile.
// Only these explicitly approved source files may be read by the manifest.
const sources = new Map([
  ["src/auth.ts", readFileSync("src/auth.ts", "utf8")],
  ["src/policy.ts", readFileSync("src/policy.ts", "utf8")],
  ["src/safety.ts", readFileSync("src/safety.ts", "utf8")],
  ["src/config.ts", readFileSync("src/config.ts", "utf8")],
  ["src/session.ts", readFileSync("src/session.ts", "utf8")],
  ["src/session-connection-config.ts", readFileSync("src/session-connection-config.ts", "utf8")],
  ["src/http-security.ts", readFileSync("src/http-security.ts", "utf8")],
  ["src/oauth.ts", readFileSync("src/oauth.ts", "utf8")],
  [
    "src/remote/control-plane-agent-operations.ts",
    readFileSync("src/remote/control-plane-agent-operations.ts", "utf8"),
  ],
  ["src/remote/crypto.ts", readFileSync("src/remote/crypto.ts", "utf8")],
  ["src/remote/policy.ts", readFileSync("src/remote/policy.ts", "utf8")],
  ["src/remote/scopes.ts", readFileSync("src/remote/scopes.ts", "utf8")],
]);
const targets = JSON.parse(readFileSync("scripts/mutation-targets.json", "utf8"));

function resolveTarget({ file, anchor }) {
  const source = sources.get(file);
  if (source === undefined) throw new Error("Unapproved mutation source: " + file);
  return resolveMutationRange(file, source, anchor);
}

const config = {
  packageManager: "pnpm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  mutate: targets.map(resolveTarget),
  reporters: ["clear-text", "html", "json"],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  coverageAnalysis: "perTest",
  ignoreStatic: true,
  concurrency: 2,
  timeoutMS: 60000,
  tempDirName: ".stryker-tmp",
};

export default config;
