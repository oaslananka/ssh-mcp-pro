# ChatGPT App Readiness

This directory is a validation scaffold for a future ChatGPT app submission. It is not a publishing manifest and it is not wired to publish an app.

The current OpenAI Apps SDK submission flow is dashboard-driven and requires a public HTTPS MCP endpoint, app verification, CSP metadata for any component resources, review test cases, screenshots, and privacy/support URLs. Until those live assets exist, `app-readiness.json` intentionally keeps `publishReady` set to `false`.

Security defaults for the future app:

- Use read-only inspection as the default profile.
- Do not collect SSH private keys, passphrases, passwords, or bearer tokens through normal chat.
- Require a user-managed config or approved credential storage flow before connecting to hosts.
- Keep strict host-key verification on by default.
- Require host allowlists for app-visible use.
- Require policy allow plus explicit user confirmation for command execution, sudo, writes, transfers, tunnels, package/service changes, and destructive filesystem operations.
- Require bearer authentication and allowed-origin restrictions for any non-loopback Streamable HTTP deployment.

Run the local readiness check with:

```bash
npm run validate:chatgpt-app
```
