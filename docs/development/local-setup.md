# Local Setup

The authoritative setup steps are in
[CONTRIBUTING.md#setup](../../CONTRIBUTING.md#setup) — this page doesn't duplicate them,
it adds the one-command shortcuts.

## Fastest path

```bash
git clone https://github.com/oaslananka/ssh-mcp-pro.git
cd ssh-mcp-pro
task install   # or: corepack enable && corepack prepare pnpm@11.28.13 --activate && pnpm install --frozen-lockfile
task verify    # lint + format:check + typecheck + test + build
```

[Taskfile.yml](../../Taskfile.yml) wraps the same pnpm scripts CONTRIBUTING.md documents
— use whichever you prefer; there is no behavioral difference between `task lint` and
`pnpm run lint`.

## What `pnpm run prepare` does

On a clone without a configured hook path, `prepare` sets the local
`core.hooksPath=.githooks` so pre-commit/pre-push hooks run automatically.
If Git already has an external hook provider configured (including inherited
settings), `prepare` preserves it and prints instructions instead of silently
overriding it. This runs automatically after `pnpm install`.

With an external provider, configure it to call the repository's `.githooks`
entrypoints where supported. Until both checks are chained, run `pnpm run check`
and the pre-commit commands in CONTRIBUTING.md before submitting changes.
CI requirements are unchanged.

## Docker-based integration tests

Integration/E2E tests exercise a real SSH fixture via Docker, not a mock:

```bash
pnpm run docker:ssh-fixture:up
pnpm run test:integration
pnpm run docker:ssh-fixture:down
```

See [docker-compose.yml](../../docker-compose.yml) and
[Dockerfile.test](../../Dockerfile.test).

## No `.devcontainer` (by design, for now)

This repo doesn't ship a `.devcontainer/`. Given the toolchain is one `pnpm install`
away from working and Docker is only needed for integration tests, this was assessed as
optional rather than required — see "Developer experience maturity" in
[docs/repo-maturity-report.md](../repo-maturity-report.md). Revisit if Windows/macOS
contributors report toolchain friction that a devcontainer would solve.
