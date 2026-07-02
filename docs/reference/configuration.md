# Configuration Reference

The canonical, exhaustive `SSH_MCP_*` table lives in
[README.md#configuration](../../README.md#configuration) and isn't duplicated here — a
second copy of a 40+ row table would drift out of sync with the first. This page groups
that table by concern, for when you know *what kind* of setting you need but not its
exact name.

## Session and resource limits

`SSH_MCP_MAX_SESSIONS`, `SSH_MCP_SESSION_TTL`, `SSH_MCP_COMMAND_TIMEOUT`,
`SSH_MCP_MAX_COMMAND_OUTPUT_BYTES`, `SSH_MCP_MAX_STREAM_CHUNKS`, `SSH_MCP_MAX_FILE_SIZE`,
`SSH_MCP_MAX_FILE_WRITE_BYTES`, `SSH_MCP_MAX_TRANSFER_BYTES`.

## SSH security policy

`SSH_MCP_HOST_KEY_POLICY`, `SSH_MCP_KNOWN_HOSTS_PATH`, `SSH_MCP_ALLOW_ROOT_LOGIN`,
`SSH_MCP_ALLOWED_CIPHERS`, `SSH_MCP_ALLOW_RAW_SUDO`, `SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS`,
`SSH_MCP_ALLOW_DESTRUCTIVE_FS`, `SSH_MCP_ALLOWED_HOSTS`, `SSH_MCP_COMMAND_ALLOW`,
`SSH_MCP_COMMAND_DENY`, `SSH_MCP_PATH_ALLOW_PREFIXES`, `SSH_MCP_PATH_DENY_PREFIXES`. See
[docs/how-to/configure-ssh-policy.md](../how-to/configure-ssh-policy.md) for task-based
guidance and [docs/security/threat-model.md](../security/threat-model.md) for why these
defaults exist.

## Local transfer and tunnel policy

`SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES`, `SSH_MCP_LOCAL_PATH_DENY_PREFIXES`,
`SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS`, `SSH_MCP_TUNNEL_DENY_BIND_HOSTS`,
`SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS`, `SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS`,
`SSH_MCP_TUNNEL_ALLOW_PORTS`, `SSH_MCP_TUNNEL_DENY_PORTS`.

## Policy engine

`SSH_MCP_POLICY_FILE`, `SSH_MCP_POLICY_MODE` — a JSON policy file plus enforce/explain
mode, for centralizing the settings above instead of many separate environment
variables. No config-schema version field currently exists for the policy file (see
[docs/development/api-stability.md](../development/api-stability.md)).

## HTTP transport

`SSH_MCP_HTTP_HOST`, `SSH_MCP_HTTP_PORT`, `SSH_MCP_HTTP_ALLOWED_ORIGINS`,
`SSH_MCP_HTTP_BEARER_TOKEN_FILE`, `SSH_MCP_ENABLE_LEGACY_SSE`,
`SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES`, `SSH_MCP_HTTP_MAX_SESSIONS`,
`SSH_MCP_HTTP_SESSION_IDLE_TTL_MS`, `SSH_MCP_HTTP_PUBLIC_URL`,
`SSH_MCP_HTTP_TRUST_PROXY`. See [docs/remote-mcp-hardening.md](../remote-mcp-hardening.md).

## OAuth (HTTP auth mode)

`SSH_MCP_HTTP_AUTH_MODE`, `SSH_MCP_OAUTH_ISSUER`, `SSH_MCP_OAUTH_AUDIENCE`,
`SSH_MCP_OAUTH_JWKS_URL`, `SSH_MCP_OAUTH_RESOURCE`, `SSH_MCP_OAUTH_REQUIRED_SCOPES`,
`SSH_MCP_OAUTH_ALLOWED_ALGORITHMS`.

## Tool exposure and connectors

`SSH_MCP_TOOL_PROFILE` / `SSH_MCP_CONNECTOR_PROFILE`,
`SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER`, `SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND`,
`SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_ARGS`,
`SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_TIMEOUT_MS`,
`SSH_MCP_CONNECTOR_DEFAULT_USERNAME`, `SSH_MCP_REMOTE_AGENT_MCP_PASSTHROUGH`. See
[Tool Profiles](../../README.md#tool-profiles) for what each profile exposes.

## Misc

`SSH_MCP_DEBUG`, `SSH_MCP_RATE_LIMIT*` (global and per-session rate limiting).
