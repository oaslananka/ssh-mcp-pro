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

Source of truth: [src/remote/agent-cli.ts](../../src/remote/agent-cli.ts).

| Command | Effect |
| --- | --- |
| (no args), `help`, `--help`, `-h` | Print usage and exit successfully |
| `--version`, `-v` | Print the installed package version and exit |
| `enroll --server <url> --token <token> [--alias <alias>]` | Exchange a one-time enrollment token and save agent credentials |
| `run` | Connect the enrolled outbound agent to its control plane |
| `status` | Show local enrollment and current policy, not live connectivity |
| `logs [--tail 60] [--follow]` | Read agent activity logs; `--follow` streams updates |
| `install-service` | Print platform service setup guidance; does not install anything |
| `uninstall-service` | Print platform service removal guidance; does not remove anything |

Unknown commands fail with a nonzero exit code. For a persistent service, use the
[platform bootstrap installer](../adding-a-device.md#step-2--run-the-bootstrap-on-the-new-device).
The `install-service` and `uninstall-service` commands are advisory, not installers.
Treat enrollment tokens as secrets and never paste them into issues or logs.
