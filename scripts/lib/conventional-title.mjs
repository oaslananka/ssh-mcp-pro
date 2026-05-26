export const CONVENTIONAL_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "release",
  "security",
  "test",
];

const typeAlternation = CONVENTIONAL_TYPES.join("|");
const conventionalPattern = new RegExp(
  `^(?:${typeAlternation})(?:\\([a-z0-9._-]+\\))?!?: .{1,200}$`,
  "u",
);
const revertPattern = /^Revert ".+"$/u;

export function isConventionalTitle(title) {
  return conventionalPattern.test(title) || revertPattern.test(title);
}

export function conventionalTitleHint() {
  return `Expected Conventional Commit title: type(scope?): subject, where type is one of ${CONVENTIONAL_TYPES.join(", ")}.`;
}
