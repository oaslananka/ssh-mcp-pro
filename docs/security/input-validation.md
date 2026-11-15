# Input Validation

This summarizes where and how untrusted input is constrained, based on the environment
variables and policy behavior already documented in the
[README configuration table](../../README.md#configuration) and
[SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md). It intentionally stays at the
policy level rather than asserting internal implementation details this audit didn't
verify line-by-line.

## Schema-level validation

Tool inputs are validated with [zod](https://www.npmjs.com/package/zod) schemas (a
runtime dependency in `package.json`); policy file contents are checked against JSON
Schema tooling (`ajv` is a devDependency used in the validation scripts under
`scripts/`). Malformed input is expected to be rejected before it reaches SSH/filesystem
operations, rather than sanitized and passed through.

## Allow/deny lists, not blanket flags

Most of the security-relevant configuration surface is an allow/deny pair rather than a
single boolean, specifically so operators can scope access narrowly instead of an
all-or-nothing switch:

- `SSH_MCP_ALLOWED_HOSTS` / implicit deny of everything else.
- `SSH_MCP_COMMAND_ALLOW` / `SSH_MCP_COMMAND_DENY`.
- `SSH_MCP_PATH_ALLOW_PREFIXES` / `SSH_MCP_PATH_DENY_PREFIXES` (remote filesystem).
- `SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES` / `SSH_MCP_LOCAL_PATH_DENY_PREFIXES` (local
  transfer endpoints).
- `SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS` / `SSH_MCP_TUNNEL_DENY_BIND_HOSTS` and the
  equivalent remote-host/port allow/deny pairs for tunnels.

Deny lists are checked in addition to allow lists — see
[docs/how-to/configure-ssh-policy.md](../how-to/configure-ssh-policy.md) for how to use
both together.

When `commandAllow` is nonempty, each allowed command must match a configured regex
**in full**, not just a prefix or substring. The policy also rejects shell control,
redirection and expansion syntax (including command chaining, pipes, newlines, `$`
expansion and command substitution) even when an allowlist regex would match. For
example, use `^git status(?: --short)?$` rather than a bare `^git ` prefix.
Review existing `commandAllow` expressions after upgrading: expressions that
previously relied on partial matching now fail closed. When no allowlist is
configured, existing command execution behavior is unchanged.

Command allowlists are not an operating-system sandbox. Even a permitted executable
may itself launch other programs, so combine a narrow command policy with
least-privilege SSH credentials and appropriate host/tool access restrictions.

## Size/resource bounds

Every buffer- or transfer-related setting has an explicit byte ceiling:
`SSH_MCP_MAX_COMMAND_OUTPUT_BYTES`, `SSH_MCP_MAX_FILE_SIZE`,
`SSH_MCP_MAX_FILE_WRITE_BYTES`, `SSH_MCP_MAX_TRANSFER_BYTES`,
`SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES`, and stream/session ceilings
(`SSH_MCP_MAX_STREAM_CHUNKS`, `SSH_MCP_MAX_SESSIONS`, `SSH_MCP_HTTP_MAX_SESSIONS`). These
exist to bound both memory use and the blast radius of any single tool call.

## Resolved gap (was: known gap)

Several CodeQL alerts (`js/file-access-to-http` / `js/http-to-file-access` in
`src/remote/agent-cli.ts` and `scripts/check-dependency-freshness.mjs`) were exactly
input-validation-shaped findings — untrusted file data influencing a network request, or
untrusted network data influencing a file write. As of 2026-07-03 all were dismissed
after independently re-verifying the rationale in `SECURITY_DECISIONS.md` against the
current code (not just re-asserting stale documentation) — see
[docs/repo-maturity-report.md](../repo-maturity-report.md) for the audit trail. 0 open
CodeQL alerts remain.
