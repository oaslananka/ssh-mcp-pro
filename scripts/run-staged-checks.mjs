#!/usr/bin/env node
import { capture, failFromResult, run } from "./lib/command.mjs";

const lintOnly = process.argv.includes("--lint-only");

const gitCheck = capture("git", ["rev-parse", "--is-inside-work-tree"]);
if (gitCheck.status !== 0) {
  console.log("run-staged-checks: not a git checkout; skipping.");
  process.exit(0);
}

const diff = capture("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
if (diff.status !== 0) {
  failFromResult(diff, "git diff");
}

const files = diff.stdout
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);

if (files.length === 0) {
  console.log("run-staged-checks: no staged files.");
  process.exit(0);
}

const prettierFiles = files.filter((file) =>
  /\.(cjs|css|html|json|jsonc|md|mjs|ts|tsx|yaml|yml)$/u.test(file),
);
const eslintFiles = files.filter((file) => /\.(ts|tsx|mjs|cjs)$/u.test(file));

if (!lintOnly && prettierFiles.length > 0) {
  run("pnpm", ["exec", "prettier", "--write", ...prettierFiles]);
  run("git", ["add", ...prettierFiles]);
}

if (eslintFiles.length > 0) {
  run("pnpm", ["exec", "eslint", ...eslintFiles]);
}

console.log(`run-staged-checks: checked ${files.length} staged file(s).`);
