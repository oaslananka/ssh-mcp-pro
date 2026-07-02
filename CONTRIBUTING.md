# Contributing

Thanks for improving `ssh-mcp-pro`. This project accepts focused pull requests that keep the MCP server buildable, tested, and safe for users who run SSH automation. Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md); see [GOVERNANCE.md](GOVERNANCE.md) for how decisions get made and by whom.

## Development Prerequisites

- Node.js 24.15.0. The supported engine range is `^22.22.2 || ^24.15.0`, but local development and CI currently use Node.js 24.15.0.
- pnpm 11.0.9 through Corepack. The repository has `engine-strict=true`, so mismatched tool versions fail early.
- Docker for integration and end-to-end tests that start SSH fixtures.
- Git with repository hooks enabled by `pnpm run prepare`.

## Setup

```bash
git clone https://github.com/oaslananka/ssh-mcp-pro.git
cd ssh-mcp-pro
corepack enable
corepack prepare pnpm@11.0.9 --activate
pnpm install --frozen-lockfile
pnpm run build
pnpm run prepare
```

`pnpm run prepare` configures `core.hooksPath=.githooks` and makes the local Git hooks executable.

## Running Tests

Use the narrowest relevant command first, then run the broader gate before opening a PR.

| Command | Purpose |
| --- | --- |
| `pnpm test` | Unit test suite. |
| `pnpm run test:coverage` | Unit tests with coverage thresholds. |
| `pnpm run test:integration` | Integration suite; requires Docker where SSH fixtures are used. |
| `pnpm run test:e2e` | End-to-end suite; requires Docker where SSH fixtures are used. |
| `pnpm run integration:docker` | Runs the integration suite through the Docker SSH fixture helper. |
| `pnpm run e2e:docker` | Runs the end-to-end suite through the Docker SSH fixture helper. |

Treat any warning or failure from the test runner as a failed check unless it is explicitly tracked in an open issue.

## Quality Gate

Run this before opening a pull request:

```bash
pnpm run check
```

`pnpm run check` runs formatting checks, documentation language checks, ruleset validation, GitHub Actions runtime validation, ESLint, TypeScript type checking, `pnpm audit --audit-level moderate`, license checks, coverage, build, metadata validation, API docs, package-content checks, and the package install smoke test.

For faster local iteration, these commands are also available:

| Command | Purpose |
| --- | --- |
| `pnpm run format:check` | Check Prettier formatting. |
| `pnpm run format` | Apply Prettier formatting. |
| `pnpm run format:staged` | Run the staged-file formatter used by the Git hook. |
| `pnpm run lint` | Run ESLint. |
| `pnpm run lint:fix` | Apply ESLint fixes where safe. |
| `pnpm run lint:staged` | Run the staged-file lint-only helper. |
| `pnpm run typecheck` | Run TypeScript with `--noEmit`. |
| `pnpm run audit` | Run `pnpm audit --audit-level moderate`. |
| `pnpm run licenses:check` | Validate dependency license policy. |
| `pnpm run check:freshness` | Generate the runtime, package-manager, and direct-dependency freshness report. |
| `pnpm run check:doc-language` | Validate documentation language conventions. |
| `pnpm run check:package-scripts` | Validate package script entrypoints resolve to existing helpers. |
| `pnpm run check:rulesets` | Validate local GitHub ruleset files when present. |
| `pnpm run verify:actions-runtime` | Verify GitHub Actions metadata does not use deprecated runtimes. |
| `pnpm run check:governance` | Validate canonical issue labels, open issue taxonomy, and Governance project coverage. |
| `pnpm run check:quality` | Run the non-packaging quality checks. |
| `pnpm run check:package` | Build and validate package metadata, docs, package contents, and install smoke. |
| `pnpm run check:push` | Run the pre-push subset: format, lint, typecheck, and unit tests. |

## Dependency Automation

GitHub Dependabot owns vulnerability alerts and security-update pull requests.
Keep the repository dependency graph, Dependabot alerts, and Dependabot security
updates enabled in GitHub repository security settings. Dependabot security PRs
should use the existing security, dependency, and priority labels and must pass
the Dependency Review job before merge.

Renovate owns scheduled non-security dependency updates through
[`renovate.json`](renovate.json). Do not add Dependabot version-update groups in
`.github/dependabot.yml` unless maintainers intentionally move non-security
update ownership away from Renovate. If both systems propose the same package,
prefer the Dependabot PR only when it is linked to an active vulnerability alert;
otherwise close the duplicate and keep the Renovate PR.

Use these checks when dependency automation policy changes:

```bash
gh api repos/oaslananka/ssh-mcp-pro --jq '.security_and_analysis'
gh api repos/oaslananka/ssh-mcp-pro/dependabot/alerts --jq 'length'
pnpm audit --audit-level moderate
```

## Dependency Freshness Policy

Runtime and dependency freshness is advisory unless a pinned version is unsupported, EOL, deprecated, missing from the lockfile, or vulnerable according to `pnpm audit --audit-level moderate`. The project intentionally does not fail CI only because a newer upstream version exists.

`pnpm run check:freshness` writes `artifacts/dependency-freshness.json` and `artifacts/dependency-freshness.md`. The report compares the Node.js engine floors, local Node version files, pinned pnpm version, and direct dependencies against official Node release metadata, the Node.js release schedule, and npm registry package metadata.

Scheduled CI and release builds upload the freshness report as a workflow artifact. Release builds also include the report in the release verification artifact set, alongside the SBOM and package checksums.

## Git Hooks

The repository uses `.githooks` plus the local pre-commit configuration:

- `pre-commit` runs staged formatting and local pre-commit checks.
- `pre-push` runs `pnpm run check:push` and all-files pre-push checks.

The hook entrypoints are `pnpm run hook:pre-commit` and `pnpm run hook:pre-push`; they are intended to be called by `.githooks`.

If hooks are not installed, run:

```bash
pnpm run prepare
```

You can run the Python pre-commit hooks directly when needed:

```bash
uvx pre-commit run --all-files
uvx pre-commit run --all-files --hook-stage manual
```

## Branch Rulesets

The main branch protection rules are version-controlled in
`.github/rulesets/main-protection.json`. The file is a GitHub repository
ruleset export that targets the default branch, requires pull requests, requires
the protected status contexts listed across the GitHub workflow files, blocks
force pushes and branch deletion, and permits only squash or rebase merge
history. Administrators are enforced: no repository administrator bypass actors
are configured for the version-controlled ruleset, and the live branch
protection configuration must keep `enforce_admins` enabled.

Repository administrators can import or compare the file from GitHub repository
settings under Rules, Rulesets, using GitHub's ruleset JSON import flow:
https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

Run this after changing local ruleset files:

```bash
pnpm run check:rulesets
```

## Issue Triage and Support

GitHub Issues is the support path and single source of truth for public work.
Use `SUPPORT.md` for response targets, stale handling, duplicate handling, and
the security advisory boundary.

Every open issue should have exactly one canonical label from each group:
`priority:*`, `area:*`, `type:*`, and `risk:*`. The machine-readable taxonomy
lives in `docs/governance/issue-taxonomy.json`.

Maintainer-owned and audit-created issues should also be represented on the
`ssh-mcp-pro Governance` GitHub Project v2, project number `5` under
`oaslananka`, with the Product, Area, Priority, Phase, Status, and Risk fields
available.

Run this after changing issue templates, labels, support policy, or governance
project fields:

```bash
pnpm run check:governance
```

The GitHub CLI token must include project access for the project validation
steps:

```bash
gh auth refresh -s read:project
```

## Package and Metadata Commands

Use these commands when a change touches package contents, metadata, generated docs, connectors, or release configuration:

| Command | Purpose |
| --- | --- |
| `pnpm run prepack` | Build and validate metadata before packaging. |
| `pnpm run prepublishOnly` | Run the full check gate before an npm publish operation. Maintainers should rely on the release workflow for actual publication. |
| `pnpm run validate:mcp-metadata` | Validate MCP registry metadata. |
| `pnpm run validate:chatgpt-app` | Validate ChatGPT app readiness metadata. |
| `pnpm run validate:claude-connector` | Validate Claude connector readiness metadata. |
| `pnpm run sync-version -- --check` | Check version consistency across metadata files. |
| `pnpm run docs:check` | Build TypeDoc with warnings treated as errors. |
| `pnpm run pack:check` | Verify package dry-run contents. |
| `pnpm run pack:install-smoke` | Verify the package installs and the CLI starts. |
| `pnpm run release:dry-run` | Validate release-please configuration and package readiness without publishing. |
| `pnpm run sbom` | Generate the CycloneDX SBOM artifact. |

Do not publish packages manually from a feature branch. The release workflow and maintainers own publication.

## Release Process

Release PRs are created by release-please from Conventional Commit history. When a release PR is merged, `.github/workflows/release.yml` creates the GitHub release and builds the release artifacts.

Automatic npm publishing is opt-in:

- Create or update the `npm-production` GitHub environment.
- In that environment, add an environment variable named `AUTO_RELEASE_PUBLISH` with the exact value `true`.
- Configure the package on npmjs.com for trusted publishing with GitHub Actions:
  - Owner: `oaslananka`
  - Repository: `ssh-mcp-pro`
  - Workflow filename: `release.yml`
  - Environment name: `npm-production`
  - Allowed action: `npm publish`
- Confirm the intended trusted-publishing payload before enabling automatic publishing:
  `npm trust github ssh-mcp-pro --file release.yml --repo oaslananka/ssh-mcp-pro --env npm-production --allow-publish --dry-run --json`.
- Keep the release job on GitHub-hosted runners with `id-token: write`; npm trusted publishing uses OIDC and does not require a long-lived npm automation token.
- Confirm `package.json` `repository.url` still matches `https://github.com/oaslananka/ssh-mcp-pro`.

If `AUTO_RELEASE_PUBLISH` is not set to `true`, the workflow records that npm publishing was skipped after attaching release assets to the GitHub release. To publish manually from a verified release artifact, download the tarball into `artifacts/`, verify the checksum attached to the GitHub release, then run:

```bash
npm publish ./artifacts/<tarball> --access public --provenance
```

Use manual publishing only for a release artifact that was produced by the release workflow. Do not run `npm publish` from feature branches or dirty worktrees.

## Docker Fixture Commands

| Command | Purpose |
| --- | --- |
| `pnpm run docker:ssh-fixture:up` | Start the Docker SSH fixture. |
| `pnpm run docker:ssh-fixture:down` | Stop the Docker SSH fixture. |
| `pnpm run integration:docker` | Run integration tests through the fixture. |
| `pnpm run e2e:docker` | Run E2E tests through the fixture. |

## Development Helpers

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Run TypeScript in watch mode. |
| `pnpm run start:http` | Start the built HTTP transport entrypoint. |
| `pnpm run lint:commits` | Validate commit message style. |
| `pnpm run lint:pr-title` | Validate PR title style. |
| `pnpm run test:pr-title-lint` | Run PR-title lint tests. |
| `pnpm run review:threads` | Check unresolved review-thread state. |
| `pnpm run release:state` | Inspect release automation state. |
| `pnpm run check:npm-name` | Check npm package-name availability. |

## Commit Messages

Use Conventional Commits:

- `feat:` for user-facing features.
- `fix:` for bug fixes.
- `docs:` for documentation-only changes.
- `test:` for tests.
- `refactor:` for behavior-preserving code changes.
- `build:` for build-system changes.
- `ci:` for workflow changes.
- `chore:` for repository maintenance.

Use `!` or a `BREAKING CHANGE:` footer only when a commit intentionally introduces a breaking change.

## Branch Naming

Use short, focused branch names:

- `feature/<short-slug>`
- `fix/<short-slug>`
- `docs/<short-slug>`
- `chore/<short-slug>`

Automation branches may use `codex/SSH-<id>-<short-slug>`.

## Pull Request Checklist

Before requesting review:

- Keep the PR focused on one issue or one cohesive change.
- Run `pnpm run check`.
- Add or update tests for behavior changes.
- Update documentation when commands, configuration, architecture, deployment, security, or user workflows change.
- Leave changelog entries to release-please; do not edit `CHANGELOG.md` manually unless maintainers ask for it.
