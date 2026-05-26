#!/usr/bin/env node
import { conventionalTitleHint, isConventionalTitle } from "./lib/conventional-title.mjs";

const cases = [
  ["fix: handle failed ssh login", true],
  ["ci(docker): verify multi-platform ghcr releases", true],
  ["feat!: remove legacy connector profile", true],
  ['Revert "fix: handle failed ssh login"', true],
  ["Fix failed ssh login", false],
  ["feat(scope with spaces): no", false],
  ["feat: ", false],
];

for (const [title, expected] of cases) {
  if (isConventionalTitle(title) !== expected) {
    throw new Error(`${conventionalTitleHint()} Failed case: ${title}`);
  }
}

console.log(`test-pr-title-lint: validated ${cases.length} case(s).`);
