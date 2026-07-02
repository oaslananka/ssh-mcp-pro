# Repository Maturity Report — ssh-mcp-pro

**Date:** 2026-07-03
**Scope:** `oaslananka/ssh-mcp-pro` (GitHub + local checkout)
**Method:** Static inspection of repo contents, GitHub API (branch protection, security
alerts, collaborators, releases, open PRs, workflow runs), and workflow source review.
Classifications use only observed evidence; no criterion is marked `Passed` without a
file, workflow run, or API response backing it.

Legend for evidence tables (current-state assessment): `Passed` · `Partial` · `Missing` ·
`Not applicable` · `Needs human confirmation`.

Legend for prioritization tables (refactor/action items): `Required now` ·
`Recommended` · `Optional` · `Future` · `Not applicable` · `Needs human confirmation`.
Each table states which legend it uses.

> **Update (2026-07-03, same day, post-merge):** The two PRs this report originally
> described as pending (`repo-maturity/professional-oss-hardening`,
> `security-fixes/codeql-and-supply-chain`) have both merged to `main`, along with two
> Dependabot Actions-version-bump PRs. What changed on the ground, in brief — full detail
> is in the sections below, not just here:
>
> - CodeQL: all 8 alerts closed (1 fixed in code, 7 dismissed with verified rationale —
>   see "Security/supply-chain maturity"). 0 open CodeQL alerts as of this update.
> - Private vulnerability reporting: confirmed **enabled** via
>   `GET /repos/.../private-vulnerability-reporting` (was "needs human confirmation").
> - Dependabot vulnerability alerts and automated security fixes: both **enabled** (were
>   disabled).
> - **New finding, not present at initial audit time:** the Trivy container scan added in
>   the security-fixes PR surfaced **50+ open alerts** against the built Docker image —
>   see "Package publishing maturity" and "Security/supply-chain maturity" below. This is
>   a real gap the original audit had no visibility into (Trivy didn't exist in the
>   pipeline yet), not a regression introduced by merging.
> - Branch protection, the release-please PR (#1), and npm trusted-publisher registration
>   remain untouched, exactly as originally recommended — still manual/maintainer
>   decisions.
>
> The narrative below is left largely as originally written (including the "before this
> PR" framing) so the audit trail stays intact; treat table rows tagged **[updated]**
> as current, and the executive summary's "seven CodeQL alerts... open" and "three PRs to
> date" as the state *at the time of the original audit*, not now.

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

## Repository inventory

| Attribute | Value | Evidence |
| --- | --- | --- |
| Visibility | Public | `GET /repos/oaslananka/ssh-mcp-pro` |
| Default branch | `main` | Same |
| License | MIT | `LICENSE`, repo metadata `license.spdx_id: MIT` |
| Maintenance signal | Active — created 2026-06-28, commits and one open release PR as of this audit | Commit history, `list_workflow_runs` |
| Archived/deprecated signal | None found | `archived: false`, `disabled: false` |
| Primary purpose | MCP server exposing policy-guarded SSH automation tools to LLM clients | `README.md` intro, `package.json` `description` |
| Stated maturity in README | Not explicitly labeled experimental/beta/stable | README documents strict security defaults and a full config surface, which reads as production-intent, but no version-stability statement (e.g. "pre-1.0, breaking changes expected") is made anywhere — **Needs human confirmation**: is `1.x` intended as stable, or still stabilizing? |

## Language and package ecosystem inventory

| Attribute | Value |
| --- | --- |
| Primary language | TypeScript (100% of `src/`) |
| Runtime | Node.js, `engines.node: ">=22.22.2"` (also supports `24.15.0`, `26.3.0` per CI matrix) |
| Package manager | pnpm `^11.5.1`, pinned exactly via `packageManager` field and `corepack`; `pnpm-lock.yaml` present and respected everywhere (no lockfile changes made by this audit) |
| Build system | `tsc` (`tsconfig.json`), no bundler — ships plain compiled JS + `.d.ts` |
| Test framework | Vitest (unit/integration/e2e/perf projects), Stryker (mutation testing), `fast-check` (property-based testing) |
| Lint/format | ESLint (`eslint.config.mjs`), Prettier, `.editorconfig` |
| Docs generator | TypeDoc, deployed to GitHub Pages |
| CLI/API/SDK/MCP surface | MCP server (stdio + Streamable HTTP transports) with two published binaries (`ssh-mcp-pro`, `ssh-mcp-pro-agent`); no separate SDK package |
| Container | Docker, multi-stage, multi-arch (`linux/amd64`, `linux/arm64`), published to GHCR |
| Monorepo/multi-package | No — confirmed single package. `pnpm-workspace.yaml` declares `packages: [.]` only; its other fields (`engineStrict`, `strictDepBuilds`, `allowBuilds`, dependency `overrides`) are pnpm supply-chain hardening settings, not a multi-package structure |
| Other language ecosystems (Python, Go, Rust) | **Not applicable** — no `pyproject.toml`, `go.mod`, or `Cargo.toml` found in the repository |

## Publishing and release inventory

| Platform | Present? | Package/artifact name | Version source | Publish trigger |
| --- | --- | --- | --- | --- |
| npm | Yes | `ssh-mcp-pro` | `package.json` `version`, synced via `scripts/sync-version.mjs` | `release.yml` → `release-assets` job, conditional on repo variable `AUTO_RELEASE_PUBLISH` |
| Docker / GHCR | Yes | `ghcr.io/oaslananka/ssh-mcp-pro` | Derived from the pushed release tag (`v*.*.*` or `ssh-mcp-pro-v*`) | `docker.yml` → `publish-ghcr`, on tag push / published release / manual dispatch |
| GitHub Releases | Configured, unused | — | release-please | 0 releases published to date |
| PyPI | **Not applicable** | — | — | No Python packaging files present |
| VS Code Marketplace | **Not applicable** | — | — | Not an editor extension |
| Homebrew | **Not applicable** (no formula found) | — | — | Could be added later as a distribution channel; not currently planned anywhere in the repo |
| MCP Registry | Yes | `io.github.oaslananka/ssh-mcp-pro` | `server.json`/`mcp.json`, validated by `mcp-registry.yml` | Manual/PR-validated, tracked in `REGISTRY_SUBMISSION.md` |
| Documentation site | Yes | TypeDoc → GitHub Pages | Generated from `src/` entry points | `docs.yml`, on push to `main` |

See "Package publishing maturity" below for the per-platform detail (metadata quality,
trusted publishing, checksums, provenance) this table only inventories.

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
| Code-Review | Missing **[updated]** | 1 collaborator. 6 PRs total as of this update: 2 Dependabot (merged), 1 release-please (open), and 3 authored and merged by the sole maintainer/owner (`author_association: OWNER`) via this audit's own branches — including this report itself. None were reviewed by an independent second party; self-merging your own PR is not what this check measures. Still `Missing` in substance, just with more data points |
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

## Package publishing maturity

### npm

| Item | Status | Evidence |
| --- | --- | --- |
| Package metadata (`name`, `description`, `keywords`, `author`, `license`) | Passed | `package.json` |
| `repository`/`bugs`/`homepage` fields | Passed | All three present and point to the correct repo |
| `files` allowlist | Passed | Explicit allowlist (`dist`, `docs` minus `docs/api`, `examples`, key root docs) rather than publishing everything |
| `exports` / `main` / `types` / `bin` | Passed | `exports: "./dist/index.js"`, `types: "dist/index.d.ts"`, two `bin` entries (`ssh-mcp-pro`, `ssh-mcp-pro-agent`) |
| `engines` | Passed | Enforced (`engine-strict=true` per `.npmrc`/CONTRIBUTING) |
| Trusted publishing / OIDC (vs. long-lived token) | Passed | `release-assets` job has `id-token: write`; the publish step explicitly runs `unset NODE_AUTH_TOKEN NPM_CONFIG_USERCONFIG` before `npm publish --provenance` — this is deliberate use of npm's OIDC trusted-publisher flow, not a stored `NPM_TOKEN`. No npm token secret was found anywhere in the workflow set |
| Publish gating | Passed | Only runs when release-please reports `release_created == 'true'` **and** repo variable `AUTO_RELEASE_PUBLISH == 'true'` — a release PR merge does not by itself publish |
| Post-publish verification | Passed | Polls `pnpm view ssh-mcp-pro@<version>` up to 18 times with backoff to confirm the publish actually landed |
| `publint` / `arethetypeswrong` | Missing | Not run. Recommended, not applied — see "Safe refactor opportunities" |
| Package version | 1.1.5 (unpublished) | `package.json`; nothing published to the npm registry yet since no release has shipped — **Needs human confirmation** by checking `npm view ssh-mcp-pro` directly if this audit's snapshot is stale |

### Docker / GHCR

| Item | Status | Evidence |
| --- | --- | --- |
| `Dockerfile` | Passed | Multi-stage build, non-root `USER node`, `HEALTHCHECK` defined |
| `.dockerignore` | Passed | Present |
| Base image pinning | Passed | `node:24-alpine` pinned by digest (`@sha256:...`), not just a tag |
| OCI labels | Passed | `title`, `description`, `url`, `documentation`, `source`, `revision`, `licenses`, `created` — all set and verified by a CI smoke-test step that asserts exact label values |
| Tag policy | Passed | Publishes both the bare version (`1.1.5`) and the release tag; no mutable `latest` tag is pushed |
| Multi-arch build | Passed | `linux/amd64,linux/arm64` via Buildx + QEMU, `--check` step validates cross-platform buildability even on PRs that don't publish |
| Provenance/SBOM on the image itself | Passed | `docker buildx build --provenance=true --sbom=true` on the published image (distinct from the npm-package SBOM) |
| Digest verification post-publish | Passed | Asserts the pushed manifest's digest matches expectations for both platforms, and cross-checks the GHCR package API for the expected tags before declaring success |
| Image vulnerability scanning (Trivy/Grype) | Partial **[updated]** | Trivy was added to `docker.yml` (advisory, `exit-code: "0"`) after this report was first written. It now runs and reports — and it found real findings: **50+ open CVE alerts** against the built image (`security/code-scanning`, tool `Trivy`), spanning Low through High severity. The large majority are in the Alpine base image's `libssl3`/`libcrypto3` packages and in `npm`'s/`corepack`'s own bundled dependencies (`undici`, `tar`, `sigstore`, `ip-address`, `brace-expansion`, and `pnpm` itself) — not in this project's application code or `dependencies`/`devDependencies`. These are pre-existing characteristics of the `node:24-alpine` base image and its bundled tooling that nobody had visibility into before Trivy was added; they are not a regression from anything in this audit. Status moves from `Missing` to `Partial`: the scanner now exists and is providing real signal, but the findings themselves are unaddressed. See the new recommended issue below |
| Hadolint (Dockerfile linting) | Missing | Not present. Recommended, low-risk to add |

### PyPI, Go modules, Rust crates, VS Code Marketplace, Homebrew

**Not applicable.** No `pyproject.toml`, `go.mod`, `Cargo.toml`, VS Code extension manifest,
or Homebrew formula exists in this repository, and nothing in the docs suggests one is
planned. If that changes, re-run this section of the audit against the relevant
ecosystem's checklist.

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
| Deprecation policy | Passed (added) | `docs/development/deprecation-policy.md` — states intent honestly as forward-looking, since no deprecation has ever happened yet |
| Security Insights (OpenSSF spec) | Passed (added) | `security-insights.yml`, schema-version 2.2.0, verified against the upstream `ossf/security-insights-spec` examples before writing; fields without verifiable evidence (bug bounty, third-party assessment, attestation predicate URIs) are omitted rather than filled with placeholders |
| Backward compatibility policy | Partial | Implied by `engines` in `package.json` and `MIGRATION.md`, not formalized as policy |

## Community maturity (CHAOSS-style)

| Metric | Status | Notes |
| --- | --- | --- |
| Bus factor | 1 | Single collaborator with admin rights; this is the single most important maturity constraint in this report |
| Time to first response | Not applicable (insufficient history) | `open_issues_count: 3` reflects 3 open pull requests (all bot-authored); `list_issues` confirms **0 actual open issues** — no human-filed issue has ever received (or needed) a first response |
| PR review process | Partial | A ruleset *describing* 1 required approval exists but is unapplied; zero PRs have ever received a human review |
| Contributor activity | Not applicable (insufficient history) | 0 non-maintainer, non-bot contributors to date |
| Release frequency | Not applicable (insufficient history) | 0 releases published |
| `good first issue` / `help wanted` label usage | Not applicable (insufficient history) | Both labels exist in the repo's default label set, but there are 0 open issues to apply them to — usage can't be assessed until issues exist |
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
| Private vulnerability reporting | Passed **[updated]** | Confirmed via `GET /repos/oaslananka/ssh-mcp-pro/private-vulnerability-reporting` → `{"enabled": true}`. No longer needs human confirmation |
| CodeQL | Passed **[updated]** | Workflow present and running weekly + on PR. All 8 originally-open alerts are now closed: #1 (High, `js/clear-text-logging` in `scripts/start-chatgpt-http.mjs`) was fixed in code (the log line no longer interpolates environment-sourced strings directly); #2–#8 were dismissed as false positives via the code-scanning API, each with a rationale re-verified against the current code (not just re-asserting stale documentation) — see `SECURITY_DECISIONS.md` for the write-up. 0 open CodeQL alerts as of this update |
| Gitleaks / secret scanning | Passed | GitHub native secret scanning **and** push protection are both enabled at the repo level (confirmed via API); this PR adds `gitleaks.yml` as a defense-in-depth layer for full-history scanning, since native secret scanning primarily covers newly pushed content |
| Dependency review | Passed | `ci.yml` job, `fail-on-severity: moderate` |
| Trivy (container image scanning) | Partial **[new, added after initial audit]** | Added to `docker.yml`, advisory-only. Surfaced 50+ open alerts against the built image, almost entirely in the Alpine base image and npm/corepack's own bundled dependencies rather than this project's code — see "Package publishing maturity" above. New visibility, not yet acted on |
| Dependabot | Passed **[updated]** | `dependabot.yml` covers `github-actions` only; npm dependencies are intentionally left to Renovate (`renovate.json`) to avoid two bots opening competing PRs for the same ecosystem — a deliberate design choice, not a gap. **Dependabot vulnerability alerts and automated security fixes are now both enabled** (were disabled at initial audit time) |
| OSV Scanner | Missing | Not present; `pnpm audit --audit-level moderate` (the `audit` script) covers similar ground for npm advisories |
| SBOM | Passed | Generated + attested per release |
| SLSA / provenance | Passed | `actions/attest-build-provenance` (build provenance, not full SLSA level claim) |
| Minimal Actions permissions | Passed | Verified directly in `release.yml`, `scorecard.yml`, `ci.yml` |

## Developer experience maturity

| Item | Status | Evidence |
| --- | --- | --- |
| One-command setup | Passed | `Taskfile.yml` (`task install`) + documented `pnpm install --frozen-lockfile` in `CONTRIBUTING.md` |
| One-command verify | Passed | `task verify` chains lint/format/typecheck/test/build; `pnpm run check` is the fuller CI-equivalent gate |
| Git hooks | Passed | `pnpm run prepare` wires `.githooks` automatically on install |
| `.env.example` | Passed (pre-existing) | Present at repo root, documents `SSH_MCP_*` variables |
| `.editorconfig` | Passed (pre-existing) | Present |
| Troubleshooting docs | Passed (added) | `docs/troubleshooting.md` |
| Local setup doc | Passed (added) | `docs/development/local-setup.md` (previously only in `CONTRIBUTING.md`; this cross-links rather than forks it) |
| `.devcontainer` | Missing | Not present — **Optional**, not required for a Node/pnpm project with a straightforward toolchain |
| Debug/logging documentation | Partial | `SSH_MCP_DEBUG` is documented in the README config table; no dedicated "how to debug a failing session" guide existed before this PR — added as part of `docs/troubleshooting.md` |

## API/CLI stability

| Item | Status | Evidence |
| --- | --- | --- |
| Public API surface definition | Partial | The MCP tool/resource/prompt registry is the primary "public API"; it's implicitly defined by `src/tools/*` and exposed via `mcp-contract` tests, but there's no single stability statement (e.g. "tool schemas are covered by SemVer, additions are minor, removals are major") |
| CLI flag stability | Partial | Flags are enumerated in `src/cli.ts` (now documented in `docs/reference/cli.md`, added by this PR); unknown flags are silently ignored by design, which is forgiving but also means a typo'd flag never errors — worth being aware of, not necessarily a defect |
| Breaking change policy | Partial | Conventional Commits `!`/`BREAKING CHANGE:` conventions exist and drive release-please's major-version bump, but there's no prose policy stating what counts as a breaking change for *this* project's specific surfaces (tool schema, CLI flags, env vars, HTTP endpoints) |
| Deprecation policy | Missing (added by this PR) | `docs/development/deprecation-policy.md` — states the current honest position (no formal deprecation window has ever been exercised yet, project is pre-1.x-maturity despite `1.x` versioning) rather than inventing a policy with no track record |
| Migration guide | Passed (pre-existing) | `MIGRATION.md` |
| MCP tool schema stability | Needs human confirmation | `test/unit/mcp-contract.test.ts` validates schema shape continuously, which is good signal, but whether schema changes are treated as SemVer-significant is a maintainer policy question, not something inferable from tests alone |
| Config schema versioning | Missing | Environment variables and the optional `SSH_MCP_POLICY_FILE` JSON have no explicit schema version field; a policy file written for one version isn't guaranteed forward-compatible by anything other than convention |

## README and badge review

Current badges (top of `README.md`): npm version, license, CI, API Docs, OpenSSF
Scorecard. This is already a restrained, non-cluttered set — the audit's main note is
about accuracy, not quantity:

| Badge | Status | Note |
| --- | --- | --- |
| npm version | Passed | Accurate once a release is published; currently reflects `package.json`'s unpublished `1.1.5` |
| License | Passed | Accurate |
| CI | Passed | Accurate, links to `ci.yml` |
| API Docs | Passed | Accurate, links to the deployed TypeDoc site |
| OpenSSF Scorecard | Needs human confirmation | Currently misleading in one specific way: `publish_results: false` means there is no published score behind this badge yet (see "Scorecard readiness" above). Recommend either fixing `publish_results` or adding a one-line caveat until it's live — not changed by this PR since it's a judgment call about how to represent an intentionally-disabled feature |
| OpenSSF Best Practices | Missing | No badge yet — correctly absent, since no badge has been issued (see `docs/openssf-evidence.md`); adding one now would be a false claim |
| Adoption signals (npm downloads, Docker pulls, GitHub release downloads) | Not applicable | No release has shipped; these would all read as zero/nonexistent right now. Revisit after the first release |
| Donation button (Buy Me a Coffee) | Passed | Present, and correctly placed in the body rather than above the fold/title — matches the guidance of using it sparingly |

No badges were added or removed by this PR — the existing set was already reasonable
and none of the audit's findings justify a change without human judgment (see the
OpenSSF Scorecard row above).

## Safe refactor opportunities

Legend: prioritization (`Required now` / `Recommended` / `Optional` / `Future` / `Not
applicable` / `Needs human confirmation`). "Safe" here means: no behavior change, no
public API impact, no build/publish system impact — confirmed by classification, not
just intent.

| Opportunity | Classification | Type | Notes |
| --- | --- | --- | --- |
| Community/governance docs (this PR) | Done | Documentation-only | Already applied |
| Diátaxis doc structure (this PR) | Done | Documentation-only | Already applied |
| `gitleaks.yml` (this PR) | Done | CI/workflow-only | Already applied, one bug fixed post-merge-attempt (missing `GITHUB_TOKEN`) |
| Add `publint` as an advisory (non-blocking) npm packaging check | Recommended | CI/workflow-only + new devDependency | Not applied by this audit — adding a devDependency and a new script is a build-tooling change, and the instructions for this audit call for leaving those as recommendations rather than auto-applying them |
| Add `arethetypeswrong` check | Optional | CI/workflow-only + new devDependency | Same reasoning as `publint`; lower priority since the package ships a single ESM entry point, not a dual CJS/ESM surface where ATW findings are most valuable |
| Add Trivy or Grype image scanning to `docker.yml` | Recommended | CI/workflow-only | No behavior change to the shipped image; only adds a scan step. Not applied here to keep this PR's diff limited to what was explicitly asked for; filed as a recommended issue |
| Add Hadolint for Dockerfile linting | Optional | CI/workflow-only | Same reasoning |
| Formalize a breaking-change/API-stability statement | Recommended | Documentation-only | Partially done via `docs/development/api-stability.md` (added by this PR); the remaining piece is a maintainer decision about what counts as "the public API" for versioning purposes |
| `docs/development/deprecation-policy.md` | Done | Documentation-only | Already applied |

## High-risk refactor opportunities

These are **not applied** by this audit under any circumstance — they require either a
maintainer decision, affect a live build/publish/security surface, or both:

| Opportunity | Classification | Type | Why it's high-risk |
| --- | --- | --- | --- |
| Fix the 7 open CodeQL alerts (1 High) | Required now (but not by this audit) | Public-API-adjacent / behavioral | Touches scripts that handle credentials and network I/O (`scripts/start-chatgpt-http.mjs`, `src/remote/agent-cli.ts`, `scripts/lib/command.mjs`); a careless fix could change error handling behavior. Needs a maintainer or a dedicated security-focused PR, not a drive-by doc-audit fix |
| Apply branch protection to `main` | Required now | GitHub Settings / admin action | Immediately changes how the sole maintainer can push; must be a deliberate choice, not an automated one |
| Re-enable Scorecard `publish_results` | Recommended | CI/workflow, cross-cutting | Requires removing global `env:`/`defaults:` blocks from multiple workflows simultaneously — a coordinated change with real potential for behavioral drift across CI, release, and Docker workflows |
| Migrate Conventional Commit tooling to strict enforcement (reject non-conforming commits at push time, not just lint) | Optional | CI/workflow-only, but changes contributor experience | Currently advisory-shaped (`lint:commits`); making it a hard gate is a policy call affecting all future contributors |
| Add a config-schema version field to `SSH_MCP_POLICY_FILE` | Future | Public-API-impacting | Would require a code change to `src/config.ts`'s policy loader and a decision about backward compatibility for existing deployments' policy files |
| Add npm ecosystem to `dependabot.yml` | Not applicable (intentional) | Dependency-management | Already assessed and rejected — see "Dependabot" row in Security/supply-chain maturity |

## Missing files (before this PR)

- `CODE_OF_CONDUCT.md`
- `GOVERNANCE.md`
- `MAINTAINERS.md`
- `ROADMAP.md`
- `.bestpractices.json`
- `docs/openssf-evidence.md`, `docs/openssf-gap-analysis.md`, `docs/openssf-proposal-links.md`
- Diátaxis folders: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`
- `docs/development/*` (coding standards, testing policy, release process, dependency
  management, commit conventions, local setup, API stability, deprecation policy)
- `docs/security/*` (threat model, release integrity, input validation, assurance case,
  secrets management)
- `docs/professionalization-plan.md`, `docs/troubleshooting.md`,
  `docs/reference/configuration.md`, `docs/reference/compatibility.md`
- `security-insights.yml` (OpenSSF Security Insights spec, schema-version 2.2.0 —
  verified against `ossf/security-insights-spec`'s own examples before writing)

All of the above are added by this PR. `NOTICE`, `THIRD_PARTY_NOTICES.md`, and
`CITATION.cff` were considered and intentionally **not** added — see "Not applied
intentionally" in the PR description.

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

## Manual GitHub settings required

None of these can be done via a file change; they need repository Settings access:

| Setting | Current state | Needed action |
| --- | --- | --- |
| Branch protection / ruleset on `main` | Not applied (404 from the protection API) | Import `.github/rulesets/main-protection.json` under Settings → Rules, or configure classic branch protection to match it |
| Required status checks | Described in the unapplied ruleset only | Apply alongside branch protection |
| Required PR review count | Described in the unapplied ruleset only (1 approval) | Apply alongside branch protection |
| Private vulnerability reporting | **Done [updated]** — confirmed `enabled: true` via API | No action needed |
| Dependabot alerts / dependency graph | **Done [updated]** — vulnerability alerts and automated security fixes both enabled via API | No action needed |
| npm trusted publishing registration | Workflow-side OIDC publish flow is implemented (no stored token, `--provenance`) | On npmjs.com, register this repo/workflow as a trusted publisher for the `ssh-mcp-pro` package (a one-time npmjs.com-side setup outside this repo) — **Needs human confirmation** whether this registration already exists, since it can't be checked from the repo |
| PyPI trusted publishing | Not applicable | No PyPI package exists |
| Docker registry (GHCR) settings | Package visibility/linkage not inspected by this audit | Confirm the GHCR package is linked to this repo and set to public visibility once the first image is published |
| OpenSSF BadgeApp final approval | Not submitted | Submit via bestpractices.dev once the two blockers in `docs/openssf-evidence.md` close |
| CODEOWNERS enforcement | File exists but isn't enforced without branch protection | Enable "Require review from Code Owners" alongside branch protection |

## Recommended issues

The following are proposed as GitHub issues (not opened automatically by this audit,
per scope — the PR description lists them so the maintainer can file them, or ask for
them to be filed as a follow-up):

1. ~~**[security] Fix CodeQL alert #1 (High): clear-text logging of sensitive
   environment data in `scripts/start-chatgpt-http.mjs`.**~~ **Done** — fixed in code.
2. ~~**[security] Review CodeQL alerts #2–#8 (Medium) and record disposition.**~~
   **Done** — all dismissed with rationale re-verified against current code;
   documented in `SECURITY_DECISIONS.md`.
3. **[governance] Decide and apply branch protection for `main`**, either by importing
   `.github/rulesets/main-protection.json` as a GitHub Ruleset or configuring classic
   branch protection to match it. **Still open** — deliberately left for the maintainer.
4. **[release] Ship the first release** (merge or re-trigger release-please PR #1) to
   exercise the release pipeline (SBOM, checksums, attestation, optional npm publish)
   end-to-end for the first time. **Still open** — deliberately left for the maintainer;
   triggers a real, hard-to-reverse publish action.
5. ~~**[security] Confirm "Private vulnerability reporting" is enabled.**~~ **Done** —
   confirmed already enabled via API.
6. **[ci] Re-evaluate OpenSSF Scorecard `publish_results: false`** — either fix the
   blocking `env:`/`defaults:` patterns across workflows, or replace the Scorecard badge
   with language clarifying no public score is currently published. **Still open** —
   investigated, deliberately not applied (see "High-risk refactor opportunities"); a
   relocation across all 7 workflows risks breaking the Windows Integration job's shell
   default in a way that can't be verified without a live Windows Actions run.
7. **[governance] Decide on a second maintainer / reviewer** before targeting OpenSSF
   Silver or a "mature OSS" claim that depends on independent code review. **Still
   open** — not something this audit can create by itself.
8. ~~**[supply-chain] Add container image vulnerability scanning** (Trivy or Grype).~~
   **Done** — added to `docker.yml`. **New follow-up issue this created:** 50+ open
   Trivy alerts now exist against the built image (Alpine base-image OpenSSL packages,
   npm/corepack's own bundled dependencies). **[supply-chain] Triage the Trivy backlog** —
   decide whether to rebuild on a newer/slimmer base image, prune corepack's cache from
   the final image layer, or accept the current baseline and document why.
9. ~~**[packaging] Add `publint`** as an advisory npm packaging check.~~ **Done** —
   added, passes cleanly against the built package.
10. **[registry] Confirm npm trusted-publisher registration exists on npmjs.com** for
    this repository/workflow. **Still open** — this is an npmjs.com-side action outside
    the repo; can't be verified or performed via the GitHub API.

## Next actions

1. Merge this PR.
2. Work through "Manual GitHub settings" (below / in the PR description) — these cannot
   be done by this automation.
3. File the "Recommended issues" above (or approve filing them as a follow-up).
4. Ship a first release to validate the release pipeline end-to-end.
5. Revisit this report after the first release and after branch protection is applied —
   several `Missing`/`Partial` rows above will likely flip to `Passed` at that point.
