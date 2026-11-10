# OpenSSF Gap Analysis

This document separates what's achievable now (Passing) from what genuinely requires
organizational change (Silver, Gold), so that neither this audit nor future readers
overclaim.

## Passing — achievable now

See [docs/openssf-evidence.md](openssf-evidence.md) for the full criterion table.

~~Seven open CodeQL alerts (one High) with no fully-current documented disposition.~~
**Resolved 2026-07-03** — see `SECURITY_DECISIONS.md`.

**2026-11-10 update:** The first-release blocker is resolved: GitHub Releases
v1.4.0 and v1.4.1 contain release notes. npm `latest` remains
v1.4.0 under a separate manual publishing workflow. This does not imply
an official Best Practices submission or a completed hosted deployment.

A new, unrelated item surfaced the same day: Trivy container-image scanning (added
after this document was first written) found 50+ open findings against the built
Docker image — see "Package publishing maturity" in
[docs/repo-maturity-report.md](repo-maturity-report.md). This doesn't block Passing
(that criterion concerns source static analysis, not container base-image CVEs) but is
worth tracking as its own item.

## Silver — not yet achievable

OpenSSF Best Practices Silver adds requirements this project cannot honestly claim yet,
specifically:

- **Two or more unassociated significant contributors.** Current bus factor is 1
  (single collaborator, `oaslananka`). Silver requires evidence of contribution from
  people not all affiliated with the same entity.
- **A documented process for reviewing and responding to bug reports within a
  well-defined window, evidenced by actual history.** The process is documented
  (`SECURITY.md`, `SUPPORT.md`), but there is no report history yet to evidence it.
- **Basic floor for cryptographic practices is fully documented** (partially met —
  `SECURITY_DECISIONS.md` covers several defaults but doesn't exhaustively enumerate
  every cryptographic operation in the codebase).

**What would need to change:** a second active contributor with merged, substantive
PRs; at least one real vulnerability report handled end-to-end; and a pass over
`SECURITY_DECISIONS.md` to make the cryptographic inventory exhaustive.

## Gold — explicitly out of scope for a claim today

Per the audit's own instructions, Gold is only evaluated as a gap list when its
preconditions are absent — and they are absent here:

| Gold precondition | Current state |
| --- | --- |
| Multiple active maintainers | 1 (see MAINTAINERS.md) |
| Independent contributor/reviewer | 0 non-bot PRs have ever been opened |
| Regular human PR review | 0 human-reviewed PRs to date |
| Branch protection | Not applied on GitHub (ruleset JSON exists but unapplied) |
| Sustainable governance | Solo-maintainer model, honestly documented in GOVERNANCE.md, not yet a multi-party governance structure |
| High test coverage sustained over time | Coverage thresholds exist (85–90%) but "sustained over time" needs release/version history that doesn't exist yet (repo is 5 days old) |
| Repeatable/reproducible release process | Implemented (SBOM, checksums, provenance) but never executed — zero releases published |

**This is a dated internal self-assessment, not an official badge.**
Do not require a second human maintainer solely for a score. Re-evaluate
criteria using current evidence before making an external submission.
