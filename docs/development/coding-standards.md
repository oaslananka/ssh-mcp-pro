# Coding Standards

This is a reference index, not a new rulebook — every rule below is already enforced by
a config file or CI job. It exists so "what are the coding standards" has one answer
instead of requiring a tour of five config files.

| Concern | Enforced by | Command |
| --- | --- | --- |
| Formatting | [.prettierrc.json](../../.prettierrc.json), [.editorconfig](../../.editorconfig) | `pnpm run format:check` |
| Linting | [eslint.config.mjs](../../eslint.config.mjs) | `pnpm run lint` |
| Type safety | [tsconfig.json](../../tsconfig.json) (`strict` mode) | `pnpm run typecheck` |
| Module size | [scripts/check-module-size.mjs](../../scripts/check-module-size.mjs) | `pnpm run check:module-size` |
| Circular dependencies | [.dependency-cruiser.mjs](../../.dependency-cruiser.mjs) | `pnpm run check:circular` |
| Unused code/exports | [knip.jsonc](../../knip.jsonc) | `pnpm run check:knip` |
| Commit messages | [.commitlintrc.json](../../.commitlintrc.json) | see [commit-conventions.md](commit-conventions.md) |
| Documentation prose | [scripts/check-doc-language.mjs](../../scripts/check-doc-language.mjs) | `pnpm run check:doc-language` |

Run everything at once with `pnpm run check:maintainability` (module size + circular
deps + unused exports) or `pnpm run check:quality` (formatting, lint, typecheck, audit,
licenses, and more — see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the full gate).

## Security-sensitive code

Files covered by [.github/CODEOWNERS](../../.github/CODEOWNERS) (`src/safety.ts`,
`src/session.ts`, `src/logging.ts`, `src/tools/`) and the mutation-tested surfaces listed
in [testing-policy.md](testing-policy.md) receive extra scrutiny. Changes there should
be justified against [SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md), not just
against passing tests.

## Pre-commit / pre-push hooks

[.pre-commit-config.yaml](../../.pre-commit-config.yaml) and the git hooks installed by
`scripts/setup-git-hooks.mjs` (run automatically via the `prepare` npm script) run a
subset of the above on staged files before commit, and the full `check:push` gate before
push. See [CONTRIBUTING.md](../../CONTRIBUTING.md#git-hooks) for details.
