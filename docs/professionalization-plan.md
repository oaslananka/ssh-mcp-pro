# Professionalization Plan

A phased plan synthesizing [docs/repo-maturity-report.md](repo-maturity-report.md)'s
"Safe refactor opportunities," "High-risk refactor opportunities," and "Recommended
issues" into an ordered sequence. This is a plan, not a commitment with dates — see
[ROADMAP.md](../ROADMAP.md) for the roadmap framing of the same underlying gaps.

## Phase 0 — Done (this audit)

Documentation, governance, and evidence gaps that required no maintainer decision and
no behavior change: `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `MAINTAINERS.md`,
`ROADMAP.md`, OpenSSF evidence/gap-analysis docs, Diátaxis documentation structure,
development-process docs, security docs, and the `gitleaks.yml` workflow.

## Phase 1 — Maintainer decisions, no code change

Status as of 2026-07-03:

1. Apply branch protection on `main` (import the existing ruleset or configure
   equivalently). **Still open.**
2. ~~Confirm private vulnerability reporting is enabled.~~ **Done** — confirmed
   already enabled via API.
3. ~~Decide on the Dependabot security-updates toggle.~~ **Done** — enabled, along
   with Dependabot vulnerability alerts.
4. Merge or re-trigger release-please PR #1 to ship the first release. **Still open**
   — deliberately left for the maintainer; triggers a real publish action.
5. Register the repo/workflow as an npm trusted publisher on npmjs.com (the workflow
   side is already implemented; this is the registry-side counterpart). **Still open**
   — an npmjs.com-side action outside the repo.

**Why this order:** branch protection and the first release are the two remaining
changes that would flip the most `Missing`/`Partial` rows in the maturity report to
`Passed` — they have outsized leverage relative to effort.

## Phase 2 — Low-risk CI additions

Status as of 2026-07-03:

1. ~~Container image vulnerability scanning (Trivy or Grype) in `docker.yml`.~~
   **Done** — Trivy added, advisory-only. It found real findings: see the new Phase 3
   item below.
2. Hadolint for Dockerfile linting. **Still open.**
3. ~~`publint` as an advisory (non-blocking) npm packaging check.~~ **Done** — added,
   passes cleanly against the built package.

## Phase 3 — Security follow-through

Status as of 2026-07-03:

1. ~~Fix CodeQL alert #1 (High: clear-text logging in `scripts/start-chatgpt-http.mjs`).~~
   **Done.**
2. ~~Review and record disposition for the remaining 7 CodeQL alerts.~~ **Done** — all
   dismissed via the code-scanning API with rationale re-verified against current code;
   written up in `SECURITY_DECISIONS.md`.
3. Re-evaluate Scorecard `publish_results: false` — either fix the blocking
   `env:`/`defaults:` patterns across workflows, or adjust the README badge. **Still
   open** — investigated; relocating those blocks across all 7 workflows risks
   silently breaking the Windows Integration job's shell default, which can't be
   verified without a live Windows Actions run.
4. **New: triage the Trivy container-image backlog.** Adding Trivy in item 1 above
   surfaced 50+ open findings against the built image — mostly the Alpine base image's
   OpenSSL packages and npm/corepack's own bundled dependencies, not this project's own
   code. Options: rebuild on a newer/slimmer base image, prune build tooling from the
   final layer, or accept and document the current baseline explicitly.

## Phase 4 — Community growth (not schedulable)

1. Land a first externally-authored, human-reviewed pull request.
2. Reconsider a second maintainer once Phase 4.1 has happened more than once — see
   [GOVERNANCE.md](../GOVERNANCE.md#path-to-adding-maintainers).
3. Revisit OpenSSF Silver readiness once Phase 4.1–4.2 give real evidence to point to.

## What's explicitly not in this plan

- No plan to pursue OpenSSF Gold/foundation-grade on any timeline — see
  [docs/openssf-gap-analysis.md](openssf-gap-analysis.md) for why that's an
  organizational precondition problem, not a checklist.
- No plan to add PyPI, Go, or Rust packaging — none of those ecosystems are used by
  this project.
- No plan to add a `.devcontainer` — assessed as optional given the toolchain is
  already a single `pnpm install` away from working.
