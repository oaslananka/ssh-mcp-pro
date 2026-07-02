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

## Size/resource bounds

Every buffer- or transfer-related setting has an explicit byte ceiling:
`SSH_MCP_MAX_COMMAND_OUTPUT_BYTES`, `SSH_MCP_MAX_FILE_SIZE`,
`SSH_MCP_MAX_FILE_WRITE_BYTES`, `SSH_MCP_MAX_TRANSFER_BYTES`,
`SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES`, and stream/session ceilings
(`SSH_MCP_MAX_STREAM_CHUNKS`, `SSH_MCP_MAX_SESSIONS`, `SSH_MCP_HTTP_MAX_SESSIONS`). These
exist to bound both memory use and the blast radius of any single tool call.

## Known gap

Two of the open CodeQL alerts (`js/file-access-to-http` / `js/http-to-file-access` in
`src/remote/agent-cli.ts` and `scripts/check-dependency-freshness.mjs`) are exactly
input-validation-shaped findings — untrusted file data influencing a network request, or
untrusted network data influencing a file write. `SECURITY_DECISIONS.md` records
rationale for some of these as accepted false positives; whether that rationale is fully
current for all open alerts needs human confirmation (see
[docs/repo-maturity-report.md](../repo-maturity-report.md)).
