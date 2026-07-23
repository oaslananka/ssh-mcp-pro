# Remote MCP hardening

Use this checklist before exposing `ssh-mcp-pro` through a public Streamable HTTP MCP endpoint.

## Streamable HTTP session resilience

- Keep `SSH_MCP_HTTP_SESSION_IDLE_TTL_MS` low enough for connector workloads that may abandon sessions without sending HTTP `DELETE`. A practical production value for ChatGPT/Cloudflare deployments is `300000`.
- Raise `SSH_MCP_HTTP_MAX_SESSIONS` above the expected burst of connector initializations. A practical production value for ChatGPT/Cloudflare deployments is `100`.
- The HTTP session registry cleans expired sessions before opening a new session. If capacity is still full, it evicts the oldest idle session with reason `capacity-evict-oldest` instead of returning a persistent 503 that can surface as an upstream 502.
- Watch logs for `HTTP MCP session removed`, `idle-timeout`, and `capacity-evict-oldest` to confirm cleanup is happening.

## Remote agent WebSocket lifecycle

- Keep `AGENT_WS_HELLO_TIMEOUT_MS` short enough that unauthenticated sockets cannot remain open indefinitely. The default is `10000` milliseconds.
- `AGENT_WS_MAX_CONNECTIONS` bounds all accepted agent WebSockets, including connections still waiting for `agent.hello`. The default is `128`.
- `AGENT_WS_MAX_CONNECTIONS_PER_AGENT` bounds active and replacement candidates for one enrolled agent. The default is `2`, which permits one live connection and one authenticated replacement attempt.
- `AGENT_WS_HEARTBEAT_INTERVAL_MS` defaults to `30000`. The server sends protocol pings and treats pong or text traffic as activity.
- `AGENT_WS_IDLE_TIMEOUT_MS` defaults to `90000` and is normalized to at least two heartbeat intervals. Idle connections close cleanly and are forcibly terminated if the close handshake does not complete.
- The `/readyz` response reports `agent_connections_open` and `agent_connections_unauthenticated`. Audit events record global/per-agent capacity rejection, hello timeout, idle timeout, replacement, and safe numeric close codes.
- Keep WebSocket compression disabled at the public boundary. Agent messages are text-only and capped at 1 MiB.

## OAuth and token verification

- Prefer OAuth mode for public endpoints.
- Configure `SSH_MCP_OAUTH_ISSUER`, `SSH_MCP_OAUTH_JWKS_URL`, and either `SSH_MCP_OAUTH_AUDIENCE` or `SSH_MCP_OAUTH_RESOURCE` explicitly.
- Use `SSH_MCP_OAUTH_ALLOWED_ALGORITHMS` to pin accepted JWT algorithms when your authorization server has a stable signing policy.
- Keep `SSH_MCP_OAUTH_REQUIRED_SCOPES` narrow and environment-specific.
- Confirm unauthorized `/mcp` requests return `401` with `WWW-Authenticate` metadata discovery headers.

## Connector routing

- Keep `SSH_MCP_REMOTE_AGENT_MCP_PASSTHROUGH` disabled by default.
- Enable it only during a controlled remote-agent routing migration where `/mcp` must bypass the remote control plane and reach the Streamable HTTP MCP handler.
- Remove the switch again after the routing migration is complete.

## Tool exposure

- Prefer `remote-safe`, `remote-readonly`, or `remote-broker` profiles for public connectors.
- Require a host allowlist for public endpoints.
- Keep credential entry in chat disabled; use the credential broker or SSH agent instead.
- Keep destructive filesystem and command policies disabled unless the environment has an explicit change-control process.

## Packaging and repository hygiene

- Never commit local bearer tokens, private keys, or generated credential files.
- Keep local credential directories ignored by Git.
- Run the full push gate before merging changes that affect remote connector behavior:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run audit
pnpm run validate:mcp-metadata
pnpm run validate:chatgpt-app
pnpm run validate:claude-connector
```
