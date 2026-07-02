# Dependency Management

## Two update bots, two ecosystems, by design

- **[renovate.json](../../renovate.json)** manages the `npm` ecosystem (production and
  dev dependencies). Patch/minor devDependency updates automerge; the MCP SDK
  (`@modelcontextprotocol/sdk`) is explicitly excluded from automerge given how central
  it is; typescript-eslint packages are grouped.
- **[.github/dependabot.yml](../../.github/dependabot.yml)** manages the
  `github-actions` ecosystem only, weekly, capped at 5 open PRs.

npm dependencies are deliberately **not** duplicated into `dependabot.yml` — running two
bots against the same ecosystem tends to produce competing PRs for the same bump. If
you're looking for why Dependabot doesn't also open npm PRs, this is why; it's a design
choice, not an oversight (see the corresponding row in
[docs/repo-maturity-report.md](../repo-maturity-report.md)).

## Vulnerability response

- `pnpm audit --audit-level moderate` (the `audit` script) runs as part of
  `check:quality`.
- `dependency-review-action` (`fail-on-severity: moderate`) runs on every pull request
  via the `dependency-review` job in [ci.yml](../../.github/workflows/ci.yml), blocking
  PRs that introduce a moderate-or-worse vulnerable dependency.
- GitHub Dependabot alerts (vulnerability scanning, distinct from the version-update
  bot config above) apply automatically on a public GitHub repository. Whether
  "Dependabot security updates" (automatic fix PRs) is enabled is a repository Settings
  toggle — see the manual actions list in the maturity report.

## License compliance

[scripts/check-licenses.mjs](../../scripts/check-licenses.mjs) enforces an allowlist
(MIT, Apache-2.0, BSD-2/3-Clause, BlueOak-1.0.0, CC-\*, ISC, Python-2.0, Unlicense)
against every resolved dependency, run via `pnpm run licenses:check` as part of
`check:quality`.

## Freshness (advisory)

`pnpm run check:freshness` (`scripts/check-dependency-freshness.mjs`) compares the
pinned Node.js floor, pnpm version, and dependency versions against upstream metadata,
producing `artifacts/dependency-freshness.{json,md}`. It's advisory unless a pinned
version is unsupported, EOL, deprecated, or vulnerable — see
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the exact policy and
[docs/audit/2026-06-05-ecosystem-audit.md](../audit/2026-06-05-ecosystem-audit.md) for
the most recent full audit.
