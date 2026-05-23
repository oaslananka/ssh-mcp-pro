# Security Policy

## Supported Versions

| Version | Security support |
| --- | --- |
| `1.x` | Supported. The current major version receives security fixes. |
| `<1.0.0` | Not supported. |

## Reporting a Vulnerability

Report suspected vulnerabilities through GitHub's private security advisory form:

https://github.com/oaslananka/ssh-mcp-pro/security/advisories/new

Do not open a public issue for credential handling bugs, authorization bypasses, command execution escapes, policy bypasses, host-key verification problems, token validation issues, or vulnerabilities that expose SSH session data.

## Response SLA

Maintainers aim to acknowledge a valid report within 7 days. The acknowledgment should confirm receipt, request any missing reproduction details, and identify the next expected update window.

## Coordinated Disclosure

Security fixes are coordinated privately until a patch is available. Public disclosure should happen after the patched release is published, release notes are available, and affected users have a practical upgrade path.

## Scope

In scope:

- Authentication or authorization bypasses in the stdio, HTTP, OAuth, or remote agent surfaces.
- Policy bypasses that allow denied commands, root login, raw sudo, filesystem mutation, transfers, or tunnels.
- Secret leakage through logs, audit records, MCP responses, package artifacts, or container images.
- Host-key verification failures that silently weaken strict mode.
- Remote control-plane vulnerabilities in enrollment, token validation, OAuth PKCE, or WebSocket agent handling.

Out of scope:

- Vulnerabilities in `node-ssh`, `ssh2`, `jose`, Node.js, OpenSSH, Docker, or operating system packages that are not exploitable through this project's exposed behavior.
- Findings that require disabling documented secure defaults.
- Denial-of-service reports based only on local resource exhaustion in a trusted development environment.
