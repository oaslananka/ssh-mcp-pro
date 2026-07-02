# Threat Model

This document states the threat model implied by the defaults already documented in
[SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md) and the README's
[Security Defaults](../../README.md#security-defaults) section, gathered into one place.
It does not introduce new claims about the implementation beyond what those documents
already assert.

## What ssh-mcp-pro is

An MCP server that gives an LLM-driven client a curated set of tools for opening SSH
sessions and running commands, transferring files, managing services, and creating
tunnels against remote hosts, mediated by a policy layer.

## Primary actors

| Actor | Trust level | Notes |
| --- | --- | --- |
| The MCP client (e.g. an LLM agent) | Partially trusted | Can issue any tool call the active [tool profile](../../README.md#tool-profiles) exposes; instructions reaching it may be ambiguous or, in the worst case, adversarial (prompt injection via tool output, a compromised upstream, etc.) |
| The operator/deployer | Trusted | Configures policy, environment variables, and which hosts are reachable |
| The remote SSH host | Partially trusted | Assumed to be a host the operator intends to manage, but output from it (command results, file contents) is untrusted data flowing back into the MCP session |
| A remote connector caller (HTTP transport) | Least trusted | Reaches the server over a network boundary; see the non-loopback HTTP restrictions below |

## What the defaults are actually defending against

1. **An LLM client instructed (by a user, a compromised prompt, or a malicious tool
   response) to do something destructive.** This is why destructive commands and
   filesystem operations (`fs_rmrf`, etc.) are denied by default
   (`SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS`, `SSH_MCP_ALLOW_DESTRUCTIVE_FS`), and why root
   login and raw `sudo` are denied by default.
2. **Host impersonation / MITM against a managed host.** This is why
   `SSH_MCP_HOST_KEY_POLICY` defaults to `strict` against a known-hosts file rather than
   trusting on first use.
3. **Accidental exposure of the server itself to the network.** This is why non-loopback
   HTTP startup requires an explicit combination of bearer/OAuth auth, an allowed
   origins list, a public HTTPS URL, strict host-key verification, a remote-safe tool
   profile, and a host allowlist — the server refuses to start non-loopback without all
   of these, rather than silently binding wide open.
4. **Overexposure to untrusted/broad connector audiences.** This is why tool profiles
   (`remote-safe`, `chatgpt`, `claude`, `remote-readonly`, `remote-broker`) are
   allowlists of a small tool subset, not the full `full` profile, for anything meant to
   be reachable by a broader audience than a trusted local stdio client.
5. **Credential/secret leakage through logs or audit trails.** `SECURITY_DECISIONS.md`
   documents audit redaction patterns and a bounded (500-event) audit buffer, and
   constant-time (`timingSafeEqual`) comparison for bearer tokens.

## Resolved gap (was: known open gap)

CodeQL previously had 7 open alerts, including one High severity finding
(`js/clear-text-logging` in `scripts/start-chatgpt-http.mjs`) that was exactly the kind
of secret-leakage-through-logs risk this threat model calls out. All 8 were resolved
2026-07-03 (1 fixed in code, 7 dismissed with re-verified rationale) — see
[docs/repo-maturity-report.md](../repo-maturity-report.md) for the audit trail. Separately,
adding Trivy container-image scanning the same day surfaced 50+ new findings against the
built Docker image (mostly the base image's bundled tooling, not this project's own
code) — see "Package publishing maturity" in that same report. That backlog is
untriaged as of this update and is the current live example of "detection isn't the
same as resolution."

## Out of scope (matches SECURITY.md)

- Vulnerabilities in dependencies that aren't reachable through this project's own
  attack surface.
- Findings that require the operator to have already disabled a secure default.
- Denial-of-service against a fully trusted local development environment.
