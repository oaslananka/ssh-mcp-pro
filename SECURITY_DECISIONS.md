# Security Decisions

This document records security-relevant defaults that affect SSH sessions, remote command execution, HTTP transport, and registry readiness.

## Strict Host-Key Verification

`SSH_MCP_HOST_KEY_POLICY` defaults to `strict`, using `~/.ssh/known_hosts` unless `SSH_MCP_KNOWN_HOSTS_PATH` is set. This prevents silent trust-on-first-use in production paths.

Non-loopback HTTP startup is refused unless host-key verification remains strict. The HTTP transport can be exposed to browsers or hosted clients, so allowing `insecure` there would combine remote reachability with unverifiable SSH host identity.

## Non-Loopback HTTP Restrictions

For non-loopback HTTP bindings, startup requires:

- Bearer authentication or configured OAuth.
- Explicit allowed origins.
- A stable HTTPS public URL.
- A remote-safe tool profile.
- A non-empty host allowlist.
- Strict SSH host-key verification.

These checks prevent accidentally exposing the full local SSH automation surface on a public interface.

## Root Login And Raw Sudo

Root login is denied by default through both security config and policy config. Raw `proc_sudo` is denied by default because it can bypass higher-level idempotent package and service helpers.

Operators who need privileged work should prefer `ensure_package`, `ensure_service`, `ensure_lines_in_file`, or `patch_apply`, with `SSH_MCP_POLICY_MODE=explain` before mutation when reviewing the plan.

## Destructive Commands And Filesystem Operations

Destructive command execution and destructive filesystem operations are denied by default. Policy allowlists, path prefixes, and explicit destructive toggles are required before tools such as `fs_rmrf` can remove remote paths.

## Audit Redaction

`AuditLog` stores policy decisions and selected action metadata. Before retention, it calls `redactSensitiveData()` and `redactErrorMessage()` so fields matching password, private key, passphrase, sudo password, secret, token, credential, auth, API key, bearer, and PEM patterns are redacted.

## Audit Buffer Size

The in-memory audit buffer keeps 500 events by default. This bounded size avoids unbounded memory growth in stdio and local HTTP deployments while retaining recent security-relevant decisions for inspection. Deployments with compliance retention requirements should export or persist audit events; OTLP log persistence is tracked separately from this baseline.

## Token Comparison

Bearer token comparison uses SHA-256 digests and `timingSafeEqual` through `constantTimeTokenEquals()`. Remote enrollment token validation also compares fixed-length hashes with `timingSafeEqual`. This avoids leaking token equality information through variable-time string comparison.

## CodeQL Agent Bootstrap Findings

CodeQL alerts #2, #4, #5, and #6 are documented false positives for the remote agent bootstrap flow. They are tracked by CodeQL as `js/http-to-file-access` / `js/file-access-to-http` because the agent writes enrollment data to its local config file and later uses that config to connect to the control plane.

The flow is intentional:

- `ssh-mcp-pro-agent enroll` requires an explicit `--server` URL and one-time enrollment token from the operator.
- Enrollment writes only to `SSHAUTOMATOR_AGENT_CONFIG` or `~/.sshautomator/agent.json` with file mode `0600`.
- Server response fields are validated with `requireString()` and `parseAgentPolicy()` before persistence.
- The agent private key is generated locally and is not received from the network.
- `ssh-mcp-pro-agent run` connects only to the enrolled `websocketUrl` from that config and sends signed agent envelopes to the configured control plane.
- The private key remains local; outbound payloads contain signed metadata, policy-limited capabilities, and policy-controlled action results.

These findings are dismissed individually with a false-positive rationale. No broad CodeQL suppression is used.
