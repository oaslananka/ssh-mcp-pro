# Troubleshooting

Common failure modes and where to look. For option-by-option config, see
[docs/reference/configuration.md](reference/configuration.md).

## The server starts but no tools show up in my MCP client

Check `SSH_MCP_TOOL_PROFILE` (or `--tool-profile`). Every profile except `full` is an
allowlist — see [Tool Profiles](../README.md#tool-profiles). If you expected the full
tool set and see only a handful, you're likely on `remote-safe` or another restricted
profile.

## `EHOSTKEY` / host key verification failures

This is `SSH_MCP_HOST_KEY_POLICY=strict` (the default) working as intended: the host
isn't in `SSH_MCP_KNOWN_HOSTS_PATH` yet, or its key changed. Add the host's key to your
known_hosts file first (e.g. `ssh-keyscan` then verify out-of-band), or see
[docs/how-to/configure-ssh-policy.md](how-to/configure-ssh-policy.md) for
lab-environment alternatives. Do not switch to `insecure` against a host you don't fully
trust.

## A tool call is denied by policy

Run `ssh_policy_explain` (or ask your MCP client to "explain the active SSH policy")
before assuming something is broken — most denials are the deny-by-default security
posture described in [SECURITY_DECISIONS.md](../SECURITY_DECISIONS.md), not a bug. See
[docs/how-to/configure-ssh-policy.md](how-to/configure-ssh-policy.md) to loosen a
specific restriction deliberately.

## Non-loopback HTTP transport won't start

By design — see [Security Defaults](../README.md#security-defaults). Non-loopback
startup requires bearer/OAuth auth, an allowed origins list, a public HTTPS URL, strict
host-key verification, a remote-safe tool profile, and a host allowlist, all configured
together. Check the startup error message; it names which of these is missing.

## Debugging a session

Set `SSH_MCP_DEBUG=true` for more verbose configuration-time diagnostics. For
request/response-level detail, check whether OpenTelemetry export is configured (see the
`@opentelemetry/*` dependencies and the telemetry-related environment variables) — this
project ships OTLP trace export support, not just console logging.

## An outbound agent disconnects during an action

`ACTION_OUTCOME_UNKNOWN` means the control plane lost or replaced the authenticated
agent connection after dispatching the action but before receiving a verified result.
The action may have completed, partially executed, or not started. Reconnection does
not replay the action. Inspect the current state before deciding whether any further
mutation is needed; do not automatically retry. A device offline before dispatch is
reported separately as `AGENT_OFFLINE`. A normal action deadline still produces
`AGENT_TIMEOUT` and also does not establish that a mutation had no effect.

If an endpoint security product reports a threat, keep protection enabled and review
its detection details. Do not repeat a blocked command or allowlist the agent to
circumvent a detection. This error does not identify the cause of the disconnection.

## Windows-specific SSH integration issues

There's a dedicated Windows SSH integration test project
(`pnpm run test:integration:windows`) — if something works on Linux but not Windows,
check that test file first; it's the closest thing to a regression harness for
Windows-specific SSH behavior.

## Filing a bug

If none of the above resolves it, open an issue using the bug report template — see
[SUPPORT.md](../SUPPORT.md) for response expectations. Include the output of
`ssh_policy_explain` and the exact `SSH_MCP_*` environment variables you've set
(redacting any secrets).
