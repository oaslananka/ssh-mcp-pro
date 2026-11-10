# Hosted remote-agent data inventory

**Engineering evidence only — not a privacy notice or terms of service.**
This document describes the repository's remote control-plane source
on 2026-11-10, **not necessarily the version deployed in production**.
It does not claim legal compliance or promise any retention period.

## Data handled in the remote control plane

| Category | Recorded data | Implementation evidence |
| --- | --- | --- |
| Account identity | GitHub ID/login/name or Google ID/email/name when configured | SQLite `users` in [remote store](../../src/remote/store.ts) |
| Dashboard sessions | Random browser session token, a stored token hash, user ID and expiry | `dashboard_sessions` in [remote store](../../src/remote/store.ts) and [dashboard](../../src/remote/web-dashboard.ts) |
| OAuth clients/codes | Client identity, redirect URIs, scopes and hashed authorization codes with expiry and use status | `oauth_clients` and `oauth_authorization_codes` in [remote store](../../src/remote/store.ts) |
| OAuth refresh sessions | Hashed rotating refresh tokens bound to OAuth client, user, resource and scopes, with a fixed 30-day maximum lifetime, use/revocation timestamps and family-replay invalidation | `oauth_refresh_tokens` in [remote store](../../src/remote/store.ts) |
| Devices | Alias, public key, policy, status, host metadata and last seen | `agents` in [remote store](../../src/remote/store.ts) |
| Enrollment | Hashed one-time tokens with expiration and use status | `agent_enrollment_tokens` in [remote store](../../src/remote/store.ts) |
| Remote actions | Tool and capability, **arguments**, status, deadline, **result**, and error details | `actions` in [remote store](../../src/remote/store.ts) |
| Security events | Event type/severity/time, optional user/device/action IDs and metadata | `audit_events` in [remote store](../../src/remote/store.ts) |
| Local agent credentials | Agent private key, server URL, device ID and execution policy | Local file described in [agent CLI](../../src/remote/agent-cli.ts) |

Remote actions can return stdout, stderr, file output and host logs.
The [executor](../../src/remote/agent-executor.ts) bounds output sizes,
but bounded size is **not** automatic secret redaction. Arguments and
results can contain sensitive host information and are persisted as JSON
in the action table.

## Expiration and erasure: observed behavior

- Dashboard cookies and session records are valid for 24 hours. Logout
  deletes the current session, while periodic maintenance also deletes
  session rows whose expiration time has passed.
- OAuth authorization codes and device enrollment tokens expire logically
  and can be used only once. The existing minute maintenance tick also
  removes physically expired code/token rows. Non-expired rows are retained
  even if already used.
- Refresh grants are rotated after use, expire after at most 30 days, and can be explicitly revoked through `/oauth/revoke`. Expired refresh records are pruned by the existing maintenance tick. A replayed used refresh token revokes its token family.
- The periodic cleanup also clears in-memory OAuth and connection state.
  It does **not** impose automatic retention/deletion on users, OAuth
  clients, devices, action history, audit events or infrastructure logs.
- Dashboard **Remove device** revokes/disconnects that device, then deletes
  the device row, associated enrollment token records and its action rows.
  **Audit events remain** for security review. **Revoke** by itself
  changes device status and is not the same as Remove device.
- No account-level export/erasure workflow, audit-erasure workflow, or
  global retention/deletion job for users, clients, actions and audit
  events was found in the inspected remote routes and store.

Source: [dashboard](../../src/remote/web-dashboard.ts),
[store](../../src/remote/store.ts),
[OAuth handler](../../src/remote/oauth-handler.ts),
[control plane](../../src/remote/control-plane.ts).

## Deployment and third-party boundaries

The documented [Coolify deployment](../coolify.md) uses one SQLite
replica and a persistent `/app/data` volume for the database and
signing keys. Redeploying the application does not itself remove the
volume. OAuth login involves GitHub or Google depending on configuration.
Infrastructure access logs, provider-side logs, external processing,
hosting jurisdiction and infrastructure-level backups **cannot be
inferred from the repository's database schema**.

## Verify before drafting a user-facing privacy notice and terms

1. Confirm operator identity, responsible contact and intended account scope.
2. Verify actual hosting region, infrastructure/OAuth processors, logs and
   their configured retention; do not purchase new services to do so.
3. Decide accurate retention and deletion behavior for identities, sessions,
   authorization records, command args/results and audit events. Explain
   the surviving audit trail after Remove device.
4. Define an actionable access/correction/deletion request process before
   promising rights, methods or timelines.
5. Verify agent/SSH-host data transfer, user responsibilities and any
   external storage or telemetry not visible in these source files.
6. Publish **separate**, reviewed HTTPS privacy and terms documents.
   `SECURITY.md` concerns vulnerability reports; the MIT `LICENSE`
   concerns source licensing. Neither is a substitute.

ChatGPT, Claude and Gemini application metadata must remain
`publishReady: false` until these and the other launch conditions
are genuinely complete. This inventory is engineering
evidence, **not** a published privacy policy.
