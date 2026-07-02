# Testing Policy

## Test layers

Defined in [vitest.config.ts](../../vitest.config.ts) as separate projects:

| Project | Location | Run with |
| --- | --- | --- |
| Unit | `test/unit/**` | `pnpm test` |
| Integration | `test/integration/**` | `pnpm run test:integration` |
| Integration (Windows SSH) | `test/integration/windows-ssh.integration.test.ts` | `pnpm run test:integration:windows` |
| E2E | `test/e2e/**` | `pnpm run test:e2e` |
| Performance | `test/perf/**` | `pnpm run test:perf` (baseline: `test:perf:baseline`) |

Integration and E2E projects run sequentially (single worker, no file parallelism) —
they exercise a real SSH fixture (see `scripts/docker-ssh-fixture.mjs` and
[docker-compose.yml](../../docker-compose.yml)) and aren't safe to parallelize against
shared fixture state.

## Coverage policy

`pnpm run test:coverage` enforces the thresholds in `vitest.config.ts`: 85% branches,
85% functions, 90% lines, 90% statements repo-wide, with a scoped 75/80/85/85 threshold
for `src/remote/**` (the remote control-plane surface, which has more integration-only
paths that are harder to unit-test in isolation). These thresholds are a CI gate, not a
suggestion — `check:quality`'s downstream `check` script fails the build below them.

## Mutation testing

`pnpm run test:mutation` runs [Stryker](../../stryker.conf.mjs) against specific line
ranges in the highest-consequence files: `auth.ts`, `policy.ts`, `safety.ts`,
`config.ts`, `session.ts`, `http-security.ts`, `oauth.ts`, and the `remote/*` control
plane. Thresholds are 80% mutation score to be considered healthy, 60% as the floor
(`break: null`, i.e. advisory rather than a hard CI failure today). See
[docs/testing.md](../testing.md) for the rationale behind the line-range allowlist and
promotion criteria for adding more files to it.

## What a PR is expected to include

Per [CONTRIBUTING.md](../../CONTRIBUTING.md): new functionality needs accompanying
tests, and `pnpm run check` (which includes `test:coverage`) must pass before a PR is
considered ready. There is currently no CI gate that *requires* a human reviewer's
approval before merge (see the branch-protection gap in
[docs/repo-maturity-report.md](../repo-maturity-report.md)) — treat the automated gate
as necessary, not sufficient.
