# Roadmap

This roadmap tracks real, currently-open gaps identified in
[docs/repo-maturity-report.md](docs/repo-maturity-report.md), not speculative
feature ideas. It will be revised as items close.

## Near term

- **Ship the first release.** Release-please PR #1 (`chore(main): release
  ssh-mcp-pro 1.2.0`) has been open since repo creation; merging it exercises
  the release pipeline (SBOM generation, checksums, build-provenance
  attestation, optional npm publish) for the first time.
- **Apply branch protection to `main`.** A ruleset already exists at
  `.github/rulesets/main-protection.json` describing the intended checks; it
  needs to actually be imported/applied via repository Settings.
- **Triage the Trivy container-image findings.** Adding Trivy scanning to
  `docker.yml` surfaced 50+ open alerts against the built image, mostly in
  the Alpine base image's OpenSSL packages and npm/corepack's own bundled
  dependencies rather than this project's code. Decide whether to rebuild on
  a newer/slimmer base image, prune build tooling from the final layer, or
  accept and document the current baseline.
- ~~Resolve the 7 open CodeQL alerts~~ — **done 2026-07-03**: 1 fixed in
  code, 7 dismissed with rationale re-verified against current code (see
  `SECURITY_DECISIONS.md`).
- ~~Confirm "Private vulnerability reporting" is enabled~~ — **done**:
  confirmed already enabled via API.
- ~~Decide on the Dependabot security-updates toggle~~ — **done**: enabled,
  alongside Dependabot vulnerability alerts.

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
