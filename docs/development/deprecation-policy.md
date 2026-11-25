# Deprecation Policy

This policy defines how compatibility changes are announced and delivered, consistent with
[API stability](api-stability.md). The [migration guide](../../MIGRATION.md) records
current deprecation notices, including the opt-in legacy HTTP+SSE bridge.

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

- A fixed calendar-day minimum notice period. The usual release-based notice in
  item 1 applies; document exceptions and the evidence supporting removal.
- Deprecation of MCP tool schema fields specifically (as opposed to whole tools) — see
  the open question in [docs/development/api-stability.md](api-stability.md) about
  whether profile/schema changes are SemVer-significant.
