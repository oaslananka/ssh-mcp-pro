# Privacy Policy for SSH MCP Pro

Last updated: November 17, 2026

This notice describes the hosted SSH MCP Pro service at https://ssh-mcp-pro.oaslananka.dev and its locally installed open-source server. This notice does not replace the policies of AI host platforms.

## Data collected by the hosted service

- Accounts: GitHub and Google account identifiers, display names, login names and email addresses where provided through authentication.
- Devices: Enrolled agent identifiers, aliases, public keys, device profiles, operating-system metadata, connection state and timestamps. SSH private keys remain on the user's device.
- Operations: Authorized agent requests, tool names, timestamps, status, request arguments, operation results, and security/audit event metadata. These records may contain command output or file metadata despite redaction of selected sensitive fields; avoid transmitting secrets in requests or outputs. These records are kept in the hosted database for troubleshooting, access control and security auditing.
- Authentication: Hashed dashboard sessions, OAuth client registrations, token hashes and related metadata needed to maintain sessions and revoke access.
- Diagnostics: Limited security events, request counts, failures and latencies may be processed to protect and operate the service.

## Data handling and sharing

SSH private keys, passwords, passphrases and API tokens should not be entered into AI chats. SSH authentication happens on the agent's own device. Tool output, including command and file content you explicitly request, may be returned to the AI platform you connected. Such platforms apply their own data policies. The service uses tenant-based access rules, capability checks and sanitization. The service owner can access limited account and usage information for administration.

## Retention and removal

Account, action and audit records are retained while needed for operation and security; do not assume automatic deletion after a fixed period. Removing a device revokes its access and removes its device record, but historical security audit events may remain. Logging out deletes the web session. Complete account removal is not currently self-service. For removal or retention requests, contact the maintainer through the project's GitHub Issues or private Security Advisories.

## Your choices and contact

Connection and device enrollment are voluntary. You may revoke devices and disconnect your MCP connection through the AI client. Only connect systems you own or are authorized to manage. Privacy questions: https://github.com/oaslananka/ssh-mcp-pro/issues . Security reports: https://github.com/oaslananka/ssh-mcp-pro/security/advisories/new .
