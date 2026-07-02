# Local Setup

The authoritative setup steps are in
[CONTRIBUTING.md#setup](../../CONTRIBUTING.md#setup) — this page doesn't duplicate them,
it adds the one-command shortcuts.

## Fastest path

```bash
git clone https://github.com/oaslananka/ssh-mcp-pro.git
cd ssh-mcp-pro
task install   # or: corepack enable && corepack prepare pnpm@11.5.1 --activate && pnpm install --frozen-lockfile
task verify    # lint + format:check + typecheck + test + build
```

[Taskfile.yml](../../Taskfile.yml) wraps the same pnpm scripts CONTRIBUTING.md documents
— use whichever you prefer; there is no behavioral difference between `task lint` and
`pnpm run lint`.

## What `pnpm run prepare` does

Configures `core.hooksPath=.githooks` so pre-commit/pre-push hooks
(`pnpm run hook:pre-commit`, `pnpm run hook:pre-push`) run automatically. This runs
automatically after `pnpm install` via the `prepare` script — you don't need to invoke
it manually unless hooks stop working.

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
