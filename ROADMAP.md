# Roadmap

This roadmap tracks current repository and product assurance priorities. The
[July 2026 repository maturity report](docs/repo-maturity-report.md) is a
historical baseline, not a live status dashboard. See [open issues](https://github.com/oaslananka/ssh-mcp-pro/issues)
for actionable work and [releases](https://github.com/oaslananka/ssh-mcp-pro/releases)
for shipped versions.

## Near term

- **Release and branch protection foundations established.** The project has
  published v1.17.1 and enforces the active `main-standard` ruleset with 13
  required checks. Keep the version-controlled snapshot and live ruleset aligned.
- **Converge dependency and supply-chain updates.** Keep current security
  patches, reviewed lockfile changes, and immutable build inputs consistent;
  investigate actual advisories without weakening security gates.
- **Validate connector isolation and recovery.** Verify public OAuth scopes,
  independent client/device permissions, and documented backup restoration
  with isolated test identities and environments.
- **Maintain product reliability.** Prioritize behavior-preserving changes to
  complex modules, cross-platform acceptance tests, and accessible onboarding.
- **Continue security monitoring.** Review fresh CodeQL, Trivy, Dependabot,
  SonarCloud and Codacy evidence rather than treating the July 2026 alert count
  as current.

## Mid term

- **Get a first externally-authored, human-reviewed pull request merged.**
  PRs merged to date are either bot-authored (Dependabot) or authored and
  self-merged by the sole maintainer; none have been reviewed by an
  independent second party. This is the single biggest lever on both the
  OpenSSF Scorecard "Code-Review" check and on moving past a bus factor of 1.
- **Re-evaluate OpenSSF Scorecard `publish_results`.** Currently disabled
  because several workflows use global `env:`/`defaults:` blocks the
  Scorecard API rejects; either fix those workflows or adjust the README
  badge to avoid implying a published score that doesn't exist.
- **Decide on a formal deprecation/backward-compatibility policy** beyond
  what's implied by `engines` in `package.json` and `MIGRATION.md`.

## Longer term

- **Consider a second maintainer** once contribution history supports it —
  see [GOVERNANCE.md](GOVERNANCE.md#path-to-adding-maintainers).
- **Pursue OpenSSF Best Practices "Passing" badge submission** once the
  code-review gap above is closed — see
  [docs/openssf-evidence.md](docs/openssf-evidence.md) for the current
  self-assessment.
- **Revisit Silver/Gold OpenSSF tiers only if** the preconditions in
  [docs/openssf-gap-analysis.md](docs/openssf-gap-analysis.md) (multiple
  maintainers, independent review, sustained release history) become true.
  This is deliberately not committed to on any timeline.

## Explicitly not planned

- This roadmap does not commit to new product features. It is scoped to
  repository/process maturity, matching the audit that produced it.
