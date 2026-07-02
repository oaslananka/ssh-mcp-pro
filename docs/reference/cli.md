# CLI Reference

ssh-mcp-pro installs two binaries (see `bin` in [package.json](../../package.json)):

- `ssh-mcp-pro` — the MCP server itself.
- `ssh-mcp-pro-agent` — the remote control-plane agent (see
  [docs/remote-mcp-hardening.md](../remote-mcp-hardening.md)).

## `ssh-mcp-pro`

Source of truth: [src/cli.ts](../../src/cli.ts).

| Flag / subcommand | Effect |
| --- | --- |
| (no args) | Starts the server over stdio transport (default) |
| `stdio` | Explicitly selects stdio transport |
| `http` | Selects the Streamable HTTP transport |
| `agent [...]` | Delegates all remaining arguments to the agent CLI (see below); consumes the rest of `argv` |
| `--help`, `-h` | Print help and exit |
| `--version`, `-v` | Print version and exit |
| `--stdio` | Forces stdio transport |
| `--transport=stdio` \| `--transport=http` | Explicit transport selection |
| `--host <value>` | HTTP bind host (overrides `SSH_MCP_HTTP_HOST`) |
| `--port <value>` | HTTP bind port (overrides `SSH_MCP_HTTP_PORT`) |
| `--bearer-token-file <path>` | Bearer token file for HTTP auth (overrides `SSH_MCP_HTTP_BEARER_TOKEN_FILE`) |
| `--enable-legacy-sse` | Enables legacy SSE compatibility (overrides `SSH_MCP_ENABLE_LEGACY_SSE`) |
| `--tool-profile <name>` | Selects a tool exposure profile (overrides `SSH_MCP_TOOL_PROFILE`) — see [Tool Profiles](../../README.md#tool-profiles) |
| `--connector-credential-provider <name>` | Selects a connector credential provider (overrides `SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER`) |
| `--no-stdio` | Unsupported/internal flag; do not rely on it |

Unknown flags are ignored rather than rejected, so that MCP clients invoking the binary
with extra arguments don't break the server.

## `ssh-mcp-pro-agent`

Delegates directly to `src/remote/agent-cli.ts` via `argv` passthrough. See
[docs/remote-mcp-hardening.md](../remote-mcp-hardening.md) and
[docs/adding-a-device.md](../adding-a-device.md) for the documented agent workflows —
this reference intentionally doesn't restate flags that aren't yet enumerated in one
place in the source, to avoid documenting something that could drift silently from the
implementation.
