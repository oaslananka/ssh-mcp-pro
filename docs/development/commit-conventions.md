# Commit Conventions

ssh-mcp-pro uses [Conventional Commits](https://www.conventionalcommits.org/), enforced
by [.commitlintrc.json](../../.commitlintrc.json) and
[scripts/lint-commits.mjs](../../scripts/lint-commits.mjs) (`pnpm run lint:commits`).
PR titles are additionally linted by
[scripts/lint-pr-title.mjs](../../scripts/lint-pr-title.mjs) (`pnpm run lint:pr-title`),
since release-please derives the changelog and version bump from these.

## Format

```
<type>[optional !][: ]<description>

[optional body]

[optional footer(s)]
```

## Types in use

`feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore` — see
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the authoritative list and examples.

## Breaking changes

Mark with `!` after the type (e.g. `feat!:`) or a `BREAKING CHANGE:` footer.
Release-please uses this to trigger a major version bump and a distinct CHANGELOG
section — see [docs/development/release-process.md](release-process.md) and
[MIGRATION.md](../../MIGRATION.md).

## Branch naming

`feature/*`, `fix/*`, `docs/*`, `chore/*` (and project-specific prefixes such as
`codex/SSH-*`) — see [CONTRIBUTING.md](../../CONTRIBUTING.md) for current conventions.
