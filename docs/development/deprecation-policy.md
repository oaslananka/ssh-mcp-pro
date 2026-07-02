# Deprecation Policy

No formal deprecation has ever happened in this project's history (it's 5 days old at
time of writing), so this document states intent, not a track record — consistent with
[docs/development/api-stability.md](api-stability.md).

## Policy going forward

1. **Announce before removing.** A deprecated tool, flag, or environment variable is
   marked as such in `CHANGELOG.md` and, where feasible, the tool/flag continues to
   function with a warning for at least one minor release before removal.
2. **Removal is a breaking change.** Per
   [docs/development/api-stability.md](api-stability.md), actual removal happens in a
   major version bump, using Conventional Commits' `!`/`BREAKING CHANGE:` convention.
3. **Security-driven deprecation is the exception.** If a default or feature is found
   to be actively unsafe (not just superseded), it may be deprecated and disabled faster
   than the normal window, with the rationale documented in
   [SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md) — safety takes priority over the
   standard notice period.
4. **`MIGRATION.md` is the landing page** for any deprecation that requires action from
   users upgrading between versions.

## What this policy does not yet cover

- A specific minimum notice period (e.g. "one minor version" vs. "90 days") — left
  unspecified until there's a real deprecation to calibrate against.
- Deprecation of MCP tool schema fields specifically (as opposed to whole tools) — see
  the open question in [docs/development/api-stability.md](api-stability.md) about
  whether profile/schema changes are SemVer-significant.
