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
