# Dependency Audit Exceptions

Dependency audit exceptions are a last resort. They must be scoped to a specific distribution surface, include reachability evidence, name an owner, define a removal condition, and expire automatically. The machine-readable source of truth is [`dependency-audit-exceptions.json`](./dependency-audit-exceptions.json).

The canonical workspace, Docker image, and release lockfile must remain free of known moderate-or-higher advisories. `pnpm run audit:packed` separately installs the generated npm tarball as an external consumer and rejects every advisory that is not listed in the exception file. It also rejects expired or stale exceptions.

## Active exception

| Advisory | Package path | Scope | Reachability assessment | Owner | Expires |
| --- | --- | --- | --- | --- | --- |
| `GHSA-frvp-7c67-39w9` | `ssh-mcp-pro > @modelcontextprotocol/sdk > @hono/node-server` | Published npm consumer graph | The affected `serve-static` implementation is not imported or invoked by ssh-mcp-pro. HTTP entrypoints use the project's own Node HTTP implementation. | `@oaslananka` | 2026-08-23 |

The latest `@modelcontextprotocol/sdk` release still constrains `@hono/node-server` to the vulnerable 1.x major. Local, CI, and container installs use the patched 2.x major through the root workspace override. npm consumers do not inherit dependency-package overrides, so the exception remains visible only for the independently installed tarball.

Remove the exception immediately when the MCP SDK accepts `@hono/node-server >=2.0.5`, or before introducing any use of the Hono Node adapter or `serve-static`.
