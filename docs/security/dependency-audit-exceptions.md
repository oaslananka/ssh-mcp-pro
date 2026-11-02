# Dependency Audit Exceptions

Dependency audit exceptions are a last resort. They must be scoped to a specific distribution surface, include reachability evidence, name an owner, define a removal condition, and expire automatically. The machine-readable source of truth is [`dependency-audit-exceptions.json`](./dependency-audit-exceptions.json).

The canonical workspace, Docker image, and release lockfile must remain free of known moderate-or-higher advisories. `pnpm run audit:packed` separately installs the generated npm tarball as an external consumer and rejects every advisory that is not listed in the exception file. It also rejects expired or stale exceptions.

## Active exceptions

**None as of 2026-11-02.** The v2 MCP SDK package migration replaces the legacy v1 SDK graph. The published-consumer audit reports zero accepted time-bounded exceptions; the machine-readable list is empty.

The historical `GHSA-frvp-7c67-39w9` exception for the old v1 SDK's transitive `@hono/node-server` chain is no longer active. The v2 Node adapter resolves the patched `@hono/node-server` 2.x dependency. Future exceptions require an explicit evidence-based review and a machine-readable expiry, not an informal ignore rule.
