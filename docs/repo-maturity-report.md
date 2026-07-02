# Repository Maturity Report — ssh-mcp-pro

**Date:** 2026-07-03
**Scope:** `oaslananka/ssh-mcp-pro` (GitHub + local checkout)
**Method:** Static inspection of repo contents, GitHub API (branch protection, security
alerts, collaborators, releases, open PRs, workflow runs), and workflow source review.
Classifications use only observed evidence; no criterion is marked `Passed` without a
file, workflow run, or API response backing it.

Legend: `Passed` · `Partial` · `Missing` · `Not applicable` · `Needs human confirmation`

## Executive summary

ssh-mcp-pro is a five-day-old (created 2026-06-28), single-maintainer TypeScript project
with an unusually deep engineering foundation for its age: pinned-SHA GitHub Actions,
CodeQL, OpenSSF Scorecard, REUSE-compliant licensing, Conventional Commits tooling,
release-please automation with SBOM generation, SHA-256 checksums, and build-provenance
attestation, a Governance issue-taxonomy, coverage thresholds (85–90%), and mutation
testing on policy-critical files. Most of the *tooling* substance normally associated
with "Professional/Mature OSS" is already present.

What is missing is not tooling but the parts of maturity that require either people or
time: there is one collaborator (`oaslananka`, admin), `main` has no GitHub branch
protection or ruleset actually applied (a ruleset JSON exists in-repo but is not active
per the Branch Protection API), no release has ever been published, no external
contributor or reviewer has ever opened or reviewed a PR (the three PRs to date are all
bot-authored — Dependabot ×2, release-please ×1), and seven CodeQL alerts (one High) are
open. Community-health documents that depend on there being a community —
`CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `ROADMAP.md` — were absent
before this change.

This PR closes the documentation/governance/evidence gaps that are safe to close without
a maintainer decision, and adds one low-risk workflow (`gitleaks.yml`). It does not
enable branch protection, does not change Dependabot/security settings, does not touch
CodeQL findings, and does not claim OpenSSF Silver/Gold — those require actions only a
repository admin or a second maintainer can take, and are listed explicitly under
"Next actions" and in the PR's manual-actions checklist.

## Current maturity level

**CNCF-style framing:** between **Experimental** and **Incubating-like**. The
engineering rigor (CI breadth, security automation, mutation testing, release
provenance) reads like a mature/Incubating project. The social characteristics (single
maintainer, zero external contributors, zero shipped releases, no branch protection)
read like an early Experimental/Sandbox project. Repo age (5 days) and commit count (3
feature commits on `main` at time of audit) mean CHAOSS metrics like release cadence,
time-to-first-response, and contributor growth have no history to measure yet — they are
reported as `Not applicable (insufficient history)` rather than graded.

**Recommended overall label: "Professional solo-maintainer OSS project, pre-first-release."**

## Target maturity level

**Professional OSS / Mature OSS**, as scoped by this task. Concretely, that means: full
GitHub Community Standards checklist satisfied, OpenSSF Best Practices **Passing**
tier achievable once a couple of process gaps close, Scorecard score improved by
enabling branch protection and dependency-review enforcement, Diátaxis-organized docs,
and governance docs that honestly describe a solo-maintainer project rather than
pretending otherwise.

**Gold/foundation-grade is explicitly out of scope for a claim in this report.** Gold
requires multiple active maintainers, independent contributor/reviewer participation,
routine human code review, branch protection, high test coverage sustained over time,
and a repeatable release history — none of which can exist five days after repo
creation with one collaborator. See "Gold / foundation-grade gap analysis" in
[docs/openssf-gap-analysis.md](openssf-gap-analysis.md) for what would need to be true
before that label is reconsidered.

## GitHub Community Standards status

| Item | Status | Evidence |
| --- | --- | --- |
| README | Passed | [README.md](../README.md) — install, quickstart, config reference, security defaults |
| LICENSE | Passed | MIT, [LICENSE](../LICENSE) |
| CONTRIBUTING | Passed | [CONTRIBUTING.md](../CONTRIBUTING.md) — setup, quality gate, commits, release process |
| CODE_OF_CONDUCT | Passed (added by this PR) | [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) |
| SECURITY | Passed | [SECURITY.md](../SECURITY.md) — private reporting, SLA, scope |
| SUPPORT | Passed | [SUPPORT.md](../SUPPORT.md) |
| Issue templates | Passed | `.github/ISSUE_TEMPLATE/{bug_report,feature_request,release_task,config}.yml` |
| Pull request template | Passed | [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) |
| CODEOWNERS | Passed | [.github/CODEOWNERS](../.github/CODEOWNERS) |

GitHub's own "Community Standards" checklist will likely still show a gap for Code of
Conduct until this PR merges — GitHub caches the checklist and reads root-level
`CODE_OF_CONDUCT.md`, which is added here for the first time.

## OpenSSF Best Practices status

Self-assessed against the [OpenSSF Best Practices Passing criteria](https://www.bestpractices.dev/en/criteria/0).
Full criterion-by-criterion notes are in [docs/openssf-evidence.md](openssf-evidence.md).
`.bestpractices.json` (added by this PR) is an **internal tracking file**, not an
official badge artifact — the OpenSSF badge is only issued via a self-certification
form at bestpractices.dev; this file exists to make filling that form out mechanical
and to keep the self-assessment under version control.

| Category | Status |
| --- | --- |
| Basics (repo, license, docs, changelog) | Passed |
| Change control (version control, unique versions, release notes) | Passed |
| Reporting (bug/vuln reporting process, response) | Passed |
| Quality (build, tests, coverage, warnings-as-errors, static analysis) | Passed |
| Security (secure delivery, vuln history, crypto, secrets handling) | Partial — see CodeQL alerts below |
| Analysis (static + dynamic analysis in CI) | Passed (CodeQL + ESLint + mutation testing) |

**Passing tier is realistically achievable.** The main blocker to actually submitting is
organizational, not technical: the badge form asks about code review process, and this
repo has never had a human-reviewed PR to point to (see Scorecard "Code-Review" below).

## Scorecard readiness

`scorecard.yml` runs weekly and on push, but `publish_results: false` is set
deliberately (documented in-workflow: the OpenSSF Scorecard API rejects workflows using
global `env:`/`defaults:` blocks, several of which exist across the workflow set, and
fixing all of them was called out of scope by whoever set this comment). This means the
Scorecard badge in the README currently resolves to **no published score**, not a
passing one — `get_scorecard` against the public API returned no data. This is worth
flagging directly: **the badge is potentially misleading until either scores are
published or the badge is removed.**

| Check | Status | Evidence |
| --- | --- | --- |
| Branch-Protection | Missing | `GET .../branches/main/protection` → 404 "Branch not protected". A ruleset JSON exists at `.github/rulesets/main-protection.json` describing 10 required status checks + 1 approval + linear history, but it is **not applied** on GitHub — Needs human confirmation whether it was ever imported via Settings → Rules, or is a design document awaiting import |
| Code-Review | Missing | 1 collaborator, 3 PRs total, all bot-authored (Dependabot ×2, release-please ×1). No human-reviewed PR exists yet |
| Maintained | Needs human confirmation | Active commit history over the observed window, but 5-day repo age is too short for Scorecard's 90-day activity window to mean anything |
| Security-Policy | Passed | `SECURITY.md` present, linked from `.github/ISSUE_TEMPLATE/config.yml` |
| License | Passed | MIT + REUSE-compliant |
| CI-Tests | Passed | `ci.yml` runs unit/integration/e2e/perf on every PR |
| Dependency-Update-Tool | Passed | `renovate.json` (npm ecosystem) + `dependabot.yml` (github-actions ecosystem) |
| Pinned-Dependencies | Passed | All third-party Actions pinned to commit SHA (verified in `release.yml`, `scorecard.yml`, `ci.yml`) |
| Token-Permissions | Passed | Every workflow sets `permissions:` at workflow level, narrowed further per job (e.g. `contents: write` only in `release`/`release-assets`) |
| Dangerous-Workflow | Passed (best-effort) | No `pull_request_target` usage found; no script-injection-shaped `run:` blocks observed in the reviewed workflows |
| SAST | Passed | CodeQL (`codeql.yml`), weekly + on PR |
| Fuzzing | Not applicable | No fuzz-testable binary parsing surface identified; property-based testing (`fast-check` dependency) is used instead, which is the more relevant technique for this codebase |

**Realistic near-term Scorecard improvement path:** enabling branch protection on `main`
(or importing the existing ruleset) and getting one human-reviewed PR would move two of
the lowest-scoring checks from `Missing` to `Passed`. Both require a maintainer/admin
action, not a code change — see "Next actions."

## Documentation maturity (Diátaxis)

Before this PR, documentation was substantial but flat (12+ root/`docs/` files with no
explicit tutorial/how-to/reference/explanation separation). This PR adds the four
Diátaxis folders and organizes existing content into them via index pages, rather than
duplicating it:

| Diátaxis category | Status | Notes |
| --- | --- | --- |
| Tutorial | Passed (added) | `docs/tutorials/getting-started.md` — new, learning-oriented walkthrough |
| How-to guides | Passed (added) | `docs/how-to/README.md` indexes existing goal-oriented docs (`adding-a-device.md`, `docker.md`, `remote-mcp-hardening.md`) and adds one new guide |
| Reference | Passed (added) | `docs/reference/README.md` indexes the canonical env-var table in README, `mcp.json`/`server.json`, and adds a CLI reference |
| Explanation | Passed (added) | `docs/explanation/architecture.md` — new, links to `ARCHITECTURE.md` and `SECURITY_DECISIONS.md` rather than duplicating them |

## Release maturity

| Item | Status | Evidence |
| --- | --- | --- |
| Semantic Versioning | Passed | `package.json` version `1.1.5`, `release-please-config.json` uses `node` release type |
| CHANGELOG.md, Keep a Changelog format | Passed | Header explicitly declares Keep a Changelog v1.1.0 + SemVer |
| GitHub Releases | Missing | `list_releases` → `[]`. No release has ever been published |
| Release notes | Needs human confirmation | release-please generates them on first release; unverified until one ships |
| Release workflow | Passed | `release.yml` — release-please PR flow, gated on `github.repository` |
| Checksums | Passed | `sha256sum` generated for the packed tarball and SBOM in `release-assets` job |
| Artifact provenance / attestation | Passed | `actions/attest-build-provenance` run twice (package + SBOM) |
| SBOM | Passed | `pnpm run sbom` (CycloneDX) generated and attested per release |
| npm publish | Needs human confirmation | Gated behind repo variable `AUTO_RELEASE_PUBLISH`; current value not inspected (requires repo Settings access) — confirm intentional |

The release pipeline is genuinely strong for a project that hasn't shipped yet. The
open PR #1 (`chore(main): release ssh-mcp-pro 1.2.0`) is the first opportunity to
exercise it end-to-end — merging it is a repository decision, not something this audit
takes on itself.

## Quality maturity

| Item | Status | Evidence |
| --- | --- | --- |
| CI workflow | Passed | `ci.yml`: dependency-review, REUSE lint, quality, unit ×3 Node versions, integration, integration-windows, e2e, perf, dependency-freshness, mutation, package, docker |
| Lint | Passed | ESLint (`eslint.config.mjs`), Prettier (`.prettierrc.json`) |
| Typecheck | Passed | `tsc --noEmit` via `check:quality` |
| Unit tests | Passed | Vitest, `test/unit/**` |
| Integration tests | Passed | `test/integration/**`, including a Windows-specific SSH integration project |
| Coverage threshold | Passed | `vitest.config.ts` enforces 85–90% branches/functions/lines/statements globally, with a scoped 75–85% threshold for `src/remote/**` |
| Mutation testing / quality gate | Passed | Stryker targets exact line ranges in `auth.ts`, `policy.ts`, `safety.ts`, `session.ts`, `http-security.ts`, `oauth.ts`, `remote/*` — the security-critical surfaces — with high/low thresholds 80/60 |
| Dependency review | Passed | `dependency-review-action`, `fail-on-severity: moderate`, runs on every PR (this was already implemented as a `ci.yml` job — no standalone `dependency-review.yml` needed) |
| Coding standards doc | Passed (added) | `docs/development/coding-standards.md` |
| Test policy doc | Passed (added) | `docs/development/testing-policy.md` |
| Dependency management policy doc | Passed (added) | `docs/development/dependency-management.md` |

## Governance maturity

| Item | Status | Evidence |
| --- | --- | --- |
| GOVERNANCE.md | Passed (added) | Describes the current solo-maintainer model honestly; does not claim a governance board that doesn't exist |
| MAINTAINERS.md | Passed (added) | Lists `@oaslananka`, cross-references `CODEOWNERS` |
| ROADMAP.md | Passed (added) | Grounded in real open items (branch protection, first release, CodeQL alerts, contributor growth) rather than invented features |
| CODEOWNERS | Passed (pre-existing) | `.github/CODEOWNERS` |
| Support policy | Passed (pre-existing) | `SUPPORT.md` |
| Deprecation policy | Missing | Not documented; `MIGRATION.md` covers version-to-version compatibility but not a formal deprecation window policy |
| Backward compatibility policy | Partial | Implied by `engines` in `package.json` and `MIGRATION.md`, not formalized as policy |

## Community maturity (CHAOSS-style)

| Metric | Status | Notes |
| --- | --- | --- |
| Bus factor | 1 | Single collaborator with admin rights; this is the single most important maturity constraint in this report |
| Time to first response | Not applicable (insufficient history) | 3 issues open, no response-time data surfaced by the API used |
| PR review process | Partial | A ruleset *describing* 1 required approval exists but is unapplied; zero PRs have ever received a human review |
| Contributor activity | Not applicable (insufficient history) | 0 non-maintainer, non-bot contributors to date |
| Release frequency | Not applicable (insufficient history) | 0 releases published |
| Documentation discoverability | Passed | README links out to all major docs; this PR adds Diátaxis structure |
| Change request acceptance process | Passed | `CONTRIBUTING.md` + PR template + required `pnpm run check` |

## License/legal maturity

| Item | Status | Evidence |
| --- | --- | --- |
| LICENSE | Passed | MIT, correct copyright holder |
| SPDX identifiers | Passed | `REUSE.toml` aggregate annotation (`SPDX-License-Identifier = "MIT"` for `**`), valid under the REUSE spec's aggregate-precedence mechanism; verified continuously by the `reuse lint` CI step |
| REUSE readiness | Passed | `REUSE.toml` + `LICENSES/MIT.txt` + CI enforcement |
| License location | Passed | Root `LICENSE`, `LICENSES/MIT.txt` |
| Third-party dependency license awareness | Passed | `scripts/check-licenses.mjs` enforces an allowlist (MIT, Apache-2.0, BSD variants, BlueOak-1.0.0, CC-\*, ISC, Python-2.0, Unlicense) as part of `check:quality` |
| NOTICE file | Not applicable | MIT does not require a NOTICE file; no bundled dependency was identified that imposes one |

## Security/supply-chain maturity

| Item | Status | Evidence |
| --- | --- | --- |
| SECURITY.md | Passed | Private reporting, 7-day SLA, explicit scope |
| Private vulnerability reporting | Needs human confirmation | `SECURITY.md` references GitHub security advisories; confirm the "Private vulnerability reporting" repo setting is actually toggled on (this is a Settings checkbox, not inferable from file contents alone) |
| CodeQL | Partial | Workflow present and running weekly + on PR; **7 open alerts** (1 High: `js/clear-text-logging` in `scripts/start-chatgpt-http.mjs`; 6 Medium: `js/indirect-command-line-injection` ×2 in `scripts/lib/command.mjs`, `js/file-access-to-http` ×3 and `js/http-to-file-access` ×1 in `src/remote/agent-cli.ts` / `scripts/check-dependency-freshness.mjs`). `SECURITY_DECISIONS.md` documents rationale for some prior CodeQL findings (#2, #4–#6) as accepted false positives, but alert numbers #1–#8 as currently reported don't have a 1:1 documented disposition — Needs human confirmation whether the existing rationale still covers all 7 open alerts or whether the High-severity clear-text-logging alert needs a code fix |
| Gitleaks / secret scanning | Passed | GitHub native secret scanning **and** push protection are both enabled at the repo level (confirmed via API); this PR adds `gitleaks.yml` as a defense-in-depth layer for full-history scanning, since native secret scanning primarily covers newly pushed content |
| Dependency review | Passed | `ci.yml` job, `fail-on-severity: moderate` |
| Dependabot | Partial | `dependabot.yml` covers `github-actions` only; npm dependencies are intentionally left to Renovate (`renovate.json`) to avoid two bots opening competing PRs for the same ecosystem — this is a deliberate design choice, not a gap, but note that repo Settings shows **Dependabot security updates: disabled** (a separate toggle from Renovate) — Needs human confirmation whether that's intentional given Renovate's `packageRules` don't guarantee same-day response to a new advisory the way Dependabot security updates do |
| OSV Scanner | Missing | Not present; `pnpm audit --audit-level moderate` (the `audit` script) covers similar ground for npm advisories |
| SBOM | Passed | Generated + attested per release |
| SLSA / provenance | Passed | `actions/attest-build-provenance` (build provenance, not full SLSA level claim) |
| Minimal Actions permissions | Passed | Verified directly in `release.yml`, `scorecard.yml`, `ci.yml` |

## Missing files (before this PR)

- `CODE_OF_CONDUCT.md`
- `GOVERNANCE.md`
- `MAINTAINERS.md`
- `ROADMAP.md`
- `.bestpractices.json`
- `docs/openssf-evidence.md`, `docs/openssf-gap-analysis.md`, `docs/openssf-proposal-links.md`
- Diátaxis folders: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`
- `docs/development/*` (coding standards, testing policy, release process, dependency management, commit conventions)
- `docs/security/*` (threat model, release integrity, input validation, assurance case)

All of the above are added by this PR. `NOTICE` and `CITATION.cff` were considered and
intentionally **not** added — see "Not applied intentionally" in the PR description.

## Missing workflows (before this PR)

- `gitleaks.yml` — added by this PR (low risk: read-only permissions, no secrets required for a public repo, additive to existing native secret scanning)
- `dependency-review.yml` — **not added**; functionally already covered by the `dependency-review` job inside `ci.yml`. Adding a duplicate standalone workflow would be redundant, not additive

## Risky changes not applied

These require a maintainer decision, a GitHub Settings change, or a code behavior
change, and are intentionally left as recommendations/issues rather than direct edits:

1. **Enabling branch protection / importing the existing ruleset on `main`.** This is a
   repository Settings action with real consequences (it would immediately start
   blocking direct pushes, including future maintenance from the sole maintainer,
   unless bypass is configured). Recommendation, not applied.
2. **Fixing the 7 open CodeQL alerts**, especially the High-severity clear-text logging
   finding in `scripts/start-chatgpt-http.mjs`. This is a code change to a script that
   handles credentials/tokens — exactly the kind of change this audit is scoped to flag,
   not silently fix. Filed as a recommended issue below.
3. **Re-enabling Scorecard `publish_results`.** The in-workflow comment says this needs
   every workflow's global `env:`/`defaults:` blocks removed first — a cross-cutting
   workflow refactor with a real chance of behavioral side effects. Flagged, not
   attempted.
4. **Adding npm ecosystem to `dependabot.yml`.** Would likely duplicate Renovate's
   existing job. Documented as an intentional non-change with rationale instead.
5. **Toggling "Dependabot security updates" in repo Settings.** A GitHub Settings
   change with a real effect (auto-opens PRs for vulnerable deps); listed as a manual
   action, not applied via API.
6. **Modifying the OpenSSF Scorecard badge or removing it** pending the
   `publish_results` decision above — left as-is, flagged for maintainer awareness.

## Recommended issues

The following are proposed as GitHub issues (not opened automatically by this audit,
per scope — the PR description lists them so the maintainer can file them, or ask for
them to be filed as a follow-up):

1. **[security] Fix CodeQL alert #1 (High): clear-text logging of sensitive environment
   data in `scripts/start-chatgpt-http.mjs`.**
2. **[security] Review CodeQL alerts #2–#8 (Medium) and record disposition** in
   `SECURITY_DECISIONS.md` (fix, suppress-with-rationale, or confirm existing rationale
   still applies).
3. **[governance] Decide and apply branch protection for `main`**, either by importing
   `.github/rulesets/main-protection.json` as a GitHub Ruleset or configuring classic
   branch protection to match it.
4. **[release] Ship the first release** (merge or re-trigger release-please PR #1) to
   exercise the release pipeline (SBOM, checksums, attestation, optional npm publish)
   end-to-end for the first time.
5. **[security] Confirm "Private vulnerability reporting" is enabled** in repo Security
   settings to match what `SECURITY.md` promises.
6. **[ci] Re-evaluate OpenSSF Scorecard `publish_results: false`** — either fix the
   blocking `env:`/`defaults:` patterns across workflows, or replace the Scorecard badge
   with language clarifying no public score is currently published.
7. **[governance] Decide on a second maintainer / reviewer** before targeting OpenSSF
   Silver or a "mature OSS" claim that depends on independent code review.

## Next actions

1. Merge this PR.
2. Work through "Manual GitHub settings" (below / in the PR description) — these cannot
   be done by this automation.
3. File the "Recommended issues" above (or approve filing them as a follow-up).
4. Ship a first release to validate the release pipeline end-to-end.
5. Revisit this report after the first release and after branch protection is applied —
   several `Missing`/`Partial` rows above will likely flip to `Passed` at that point.
