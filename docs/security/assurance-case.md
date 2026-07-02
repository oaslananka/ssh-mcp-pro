# Assurance Case

An assurance case is an argument, backed by evidence, for why a project should be
trusted at its current maturity level — not a claim that it's beyond scrutiny. This one
covers ssh-mcp-pro as of 2026-07-03.

## Claim

ssh-mcp-pro's automated engineering controls are strong enough to justify normal OSS
trust (install it, review its defaults, use its documented policy controls) for a
project at "pre-first-release, single-maintainer" maturity — but not yet strong enough
to justify Silver/Gold-tier OpenSSF trust, because several controls that require human
process (independent code review, sustained release history, resolved security
findings) have not yet been exercised.

## Supporting evidence

1. **Static analysis runs continuously and is visible.** CodeQL (weekly + per-PR),
   ESLint, and TypeScript strict mode all gate CI. → [ci.yml](../../.github/workflows/ci.yml),
   [codeql.yml](../../.github/workflows/codeql.yml).
2. **Security-critical code has targeted, not just incidental, test coverage.**
   Mutation testing specifically targets `auth.ts`, `policy.ts`, `safety.ts`,
   `session.ts`, `http-security.ts`, `oauth.ts`, and the remote control plane. →
   [docs/development/testing-policy.md](../development/testing-policy.md).
3. **Defaults are deny-by-default and documented with rationale, not just asserted.** →
   [SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md),
   [docs/security/threat-model.md](threat-model.md).
4. **Supply-chain integrity mechanisms exist for releases** (checksums, SBOM, build
   provenance attestation) → [docs/security/release-integrity.md](release-integrity.md).
5. **License and dependency provenance are enforced, not just documented** (REUSE lint
   in CI, license allowlist script, dependency-review-action on every PR).

## Counter-evidence / limits on the claim

1. **No release has ever shipped.** Every mechanism in (4) is implemented but
   unexercised end-to-end.
2. **No pull request has ever received independent human review.** All three PRs to
   date are bot-authored. The claim above does not extend to "this project has been
   independently verified by a second person" — it hasn't.
3. **Branch protection is not actually applied on GitHub**, despite a ruleset
   definition existing in-repo. Anyone with push access (currently just the sole
   maintainer) can push directly to `main` today.
4. **Seven CodeQL alerts are open**, including one High severity. Static analysis
   running is evidence of *detection* capability, not evidence that everything it has
   detected has been resolved.

## Bottom line

Trust the automated controls; don't yet extend that trust to "this has been reviewed by
more than one person" or "this has shipped and been used in the wild," because neither
is true yet. Re-assess this case after the items in
[ROADMAP.md](../../ROADMAP.md#near-term) close.
