# Migration Guide

## 1.x

Version `1.0.0` is the initial public baseline for this repository. There are no earlier published package versions with a supported automated migration path.

When upgrading within `1.x`, preserve these compatibility expectations:

- Node.js must satisfy `>=22.22.2` (Node 24 and 26 are tested in CI).
- pnpm must satisfy `^11.28.13` for current development and build tooling.
- Existing stdio MCP client configs can continue to launch `ssh-mcp-pro` with no arguments.
- HTTP deployments should keep explicit authentication, allowed origins, host allowlists, strict host-key verification, and a remote-safe tool profile.

## Migrate legacy HTTP+SSE clients to Streamable HTTP

Legacy HTTP+SSE (the separate `GET /sse` and `POST /messages` transport)
is deprecated. Its upstream `@modelcontextprotocol/server-legacy` package is
a frozen migration bridge. It remains available as an opt-in compatibility
path, disabled by default. This notice does not deprecate stdio, legacy
2025-era Streamable HTTP sessions on `/mcp`, or the authenticated remote-agent
control plane.

1. Inventory the actual clients using `/sse`. Upgrade each client to a version
   that supports Streamable HTTP, select that transport, and change its URL to
   the same server's `/mcp` endpoint. A URL change alone is not sufficient for
   a client that only implements HTTP+SSE.
2. Preserve the intended authentication, OAuth scopes or bearer credentials,
   allowed origins, host allowlists and tool profile. Do not enable anonymous
   access or broader privileges to troubleshoot a connection.
3. Connect through Streamable HTTP and confirm initialization or modern
   protocol discovery, `tools/list`, and a permitted non-mutating tool call
   (for example `connector_status` on the standard SSH endpoint, if exposed).
   Repeat with each client's actual identity and intended tool profile.
4. After all affected clients pass, set `SSH_MCP_ENABLE_LEGACY_SSE=false`
   (or `http.enableLegacySse: false` in the server config) and remove the
   `--enable-legacy-sse` launch flag. Restart the service through its normal
   supervisor, then verify that `/mcp` still works and authorized requests to
   `/sse` and `/messages` return 404. Follow the
   [hosted recovery gate](docs/coolify.md#encrypted-backup-recovery-gate) if
   updating a hosted image.
5. If a required client still cannot connect, retain the existing opt-in bridge
   temporarily with the same access restrictions and upgrade the client.
   Do not assume an old SSE client is interchangeable with Streamable HTTP.

An enabled bridge emits a migration warning at HTTP startup. Removal of
the bridge is a future major-version decision, not part of this change.
Allow at least one minor release with notice where feasible and document
client compatibility evidence before removing the endpoints, flags and
dependency. No removal date or complete migration of external self-hosted
clients is claimed. See the [deprecation policy](docs/development/deprecation-policy.md)
and the [official SDK migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2).

Future breaking changes should add a new section with required config, policy, or data migration steps before release.
