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
- The `Dependency Review` job in [ci.yml](../../.github/workflows/ci.yml) is the single
  canonical dependency review for pull requests. It uses
  `dependency-review-action` with `fail-on-severity: moderate`, so a newly introduced
  advisory rated moderate, high, or critical blocks the pull request. A second standalone
  dependency-review workflow is intentionally not used because duplicate checks can apply
  contradictory thresholds and create ambiguous merge signals.
- The same job enforces the repository license allowlist. The allowlist is kept identical
  to [scripts/check-licenses.mjs](../../scripts/check-licenses.mjs) by a regression test;
  changing either policy requires a reviewed pull request that updates both surfaces.
- GitHub Dependabot alerts (vulnerability scanning, distinct from the version-update
  bot config above) apply automatically on a public GitHub repository. Whether
  "Dependabot security updates" (automatic fix PRs) is enabled is a repository Settings
  toggle — see the manual actions list in the maturity report.

### Published artifact verification

`pnpm run audit:packed` installs the generated npm tarball in a clean consumer project
and audits the resolved production graph without inheriting workspace overrides. Any
remaining finding must match the machine-readable, time-bounded policy in
[dependency-audit-exceptions.json](../security/dependency-audit-exceptions.json) and the
public rationale in [Dependency Audit Exceptions](../security/dependency-audit-exceptions.md).
Unexpected, expired, or stale exceptions fail the package gate.

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
