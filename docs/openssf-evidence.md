# OpenSSF Best Practices — Evidence

Self-assessment against the [OpenSSF Best Practices Passing criteria](https://www.bestpractices.dev/en/criteria/0),
originally assessed 2026-07-03; published release notes independently rechecked 2026-11-10. This is a repo-side evidence log, not an official OpenSSF
artifact — the actual badge is issued by submitting these answers at
[bestpractices.dev](https://www.bestpractices.dev/). See `.bestpractices.json` for the
same answers in a structured tracking form used to prepare that submission.

Status legend: `Met` / `Partially met` / `Unmet` / `N/A`, matching the badge site's own
vocabulary.

## Basics

| Criterion | Status | Evidence |
| --- | --- | --- |
| Project has a public repository with a version-controlled history | Met | github.com/oaslananka/ssh-mcp-pro |
| Project uses a common distributed version control system (Git) | Met | Git |
| Project has FLOSS license | Met | `LICENSE` (MIT), `REUSE.toml` |
| License is OSI-approved | Met | MIT |
| Documentation: basic description of purpose | Met | README.md intro |
| Documentation: how to obtain/provide feedback and contribute | Met | CONTRIBUTING.md, SUPPORT.md |
| Interim versions/releases are identifiable | Met | Conventional Commits + release-please tagging (GitHub releases v1.4.0 and v1.4.1 verified 2026-11-10) |

## Change control

| Criterion | Status | Evidence |
| --- | --- | --- |
| Public version-controlled source repository | Met | GitHub |
| Repository tracks changes with commit-level granularity | Met | Git history |
| Releases have version numbers following a documented convention | Met | SemVer via release-please |
| Project has release notes for each new major/minor release | Partially met | `CHANGELOG.md` follows Keep a Changelog; no release has actually been cut yet to verify end-to-end |

## Reporting

| Criterion | Status | Evidence |
| --- | --- | --- |
| Project has a process for reporting bugs | Met | Issue templates, `.github/ISSUE_TEMPLATE/config.yml` |
| Project has a documented vulnerability reporting process | Met | `SECURITY.md` — private advisories, 7-day SLA |
| Project acknowledges vulnerability reports within a reasonable time | Unmet (no data) | No vulnerability report has been received yet to measure against the documented SLA |

## Quality

| Criterion | Status | Evidence |
| --- | --- | --- |
| Project uses at least one automated test suite | Met | Vitest: unit, integration, e2e, perf projects |
| Project has FLOSS automated test suite invoked on all commits/PRs | Met | `ci.yml` |
| New functionality has accompanying tests (documented expectation) | Met | `CONTRIBUTING.md` PR checklist requires it |
| Project has a general policy for test coverage | Met | `vitest.config.ts` enforces 85–90% thresholds |
| Project uses continuous integration | Met | `ci.yml` on push/PR/schedule |
| Project has at least one static analysis tool applied | Met | CodeQL, ESLint, mutation testing (Stryker) |
| All medium/high-severity static analysis findings are addressed | Met (2026-07-03) | All 8 CodeQL alerts closed: 1 fixed in code, 7 dismissed with rationale re-verified against current code — see `SECURITY_DECISIONS.md`. (Separately, Trivy container-image scanning added the same day found 50+ new findings against the built Docker image, mostly in the base image's bundled tooling rather than this project's source — tracked as an open item in `docs/repo-maturity-report.md`, not part of this specific criterion, which concerns source static analysis) |

## Security

| Criterion | Status | Evidence |
| --- | --- | --- |
| Project has a documented security architecture / defaults | Met | SECURITY_DECISIONS.md, README "Security Defaults" |
| Cryptographic functions use public, well-reviewed protocols | Met | `jose` for JWT/OAuth verification (per `package.json` deps); no bespoke crypto identified |
| Secrets are not stored in the repository | Met (best-effort) | GitHub secret scanning + push protection enabled; `gitleaks.yml` added by this PR for defense-in-depth history scanning |
| Delivery mechanisms protect against MITM | Met | npm publish over registry.npmjs.org HTTPS with npm provenance; container images pinned by digest per `docs/docker.md` |

## Analysis

| Criterion | Status | Evidence |
| --- | --- | --- |
| Static analysis applied to any language used | Met | CodeQL (JS/TS query pack) |
| Dynamic analysis applied | Partially met | Mutation testing (Stryker) exercises runtime behavior of security-critical code paths; no fuzzing harness exists, and none is currently believed necessary (see repo-maturity-report.md, "Fuzzing: Not applicable") |

## Bottom line

As of 2026-11-10 the historical first-release blocker is resolved:
GitHub Releases v1.4.0 and v1.4.1 are published with notes. npm
`latest` remains v1.4.0 due to the intentionally separate manual registry
publication. Do not equate release notes with an npm publication or hosted deployment.

Historical 2026-07-03 image-scanning findings below are not a current scan.
Do not claim a current container CVE count without a new scan.
This internal self-assessment is still not submitted to Best Practices;
no Passing, Silver or Gold badge is claimed.
