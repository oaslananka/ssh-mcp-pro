# Three-platform web publication readiness — 2026-11-17

A single tenant-scoped remote control plane serves ChatGPT, Claude and Gemini. Production HTTPS endpoint: `https://ssh-mcp-pro.oaslananka.dev/mcp`.

## Verified in the implementation

- MCP SDK v2, Streamable HTTP and backward-compatible 2025-11-25 initialization.
- Protected resource metadata, OAuth authorization-server discovery, PKCE S256, dynamic client registration and JWT scope validation.
- User- and scope-filtered tools, agent policy enforcement and cross-tenant isolation with integration coverage.
- Safe ChatGPT, Claude and Gemini local tool profiles; one-command localhost web shortcut.
- Hosted Privacy and Terms routes plus owner-only Usage & Users without a paid analytics service.

## External gates that cannot be proven from source code

All three publication manifests keep `publishReady: false` until **actual** provider acceptance. Running the repository's validators only verifies metadata consistency.

### ChatGPT Work / Plugins

1. Verify publisher identity and domain ownership using the official publisher portal. The challenge route `/.well-known/openai-apps-challenge` responds only with the operator-supplied `SSH_MCP_OPENAI_DOMAIN_CHALLENGE`.
2. Have the service operator review the hosted Privacy and Terms, including retention and AI output disclosures.
3. Connect with a separate eligible ChatGPT Work test account; test the full OAuth flow, tool discovery, permitted inspection, denied mutation, authorized mutation, and tenant isolation.
4. Capture authentic provider screenshots and test cases, then submit for review. No directory approval is implied.

Guides: https://developers.openai.com/plugins/deploy/app-review and https://developers.openai.com/plugins/build/mcp-server

### Claude Web / custom connector

1. Add the remote HTTPS MCP endpoint using the Claude Web custom connector interface under an eligible account.
2. Exercise OAuth, per-account MCP tools, permitted inspection, expected denial and disconnect/recovery flows.
3. Verify directory eligibility, published policy content and provider submission acceptance.

Guides: https://claude.com/docs/connectors/building/index and https://claude.com/docs/directory/publish

### Gemini Web Developer Mode / Google Connected Apps

1. Register an eligible developer/app in the Google Connected Apps Console. This differs from the Gemini CLI extension and Gemini API remote tool schema.
2. Check Google OAuth, 2025-11-25 initialize, tools/list, scoped inspection and denied mutation in actual Gemini Web. Automated tests verify the protocol only, not provider UI approval.
3. Obtain actual Google approval before marking OAuth or the publication manifest complete.

Guides: https://developers.google.com/connected-apps/mcp/guidelines and https://developers.google.com/connected-apps/mcp/server-optimization

## Deployment and owner operations

The existing production service uses Coolify and a persistent SQLite volume; no additional continuously running service or paid telemetry is needed. Preserve the SQLite volume and OAuth/agent signing keys across deployment. Configure `SSH_MCP_DASHBOARD_OWNER_GITHUB_LOGINS` or `SSH_MCP_DASHBOARD_OWNER_GOOGLE_EMAILS` with explicitly authorized service owner identities. These settings control **only the usage admin screen**, not user sign-up. Keep existing public enrollment controls, including `AUTH_ALLOW_ALL_USERS=false`, unchanged until a deliberate product decision.

## User acceptance and release definition of done

First visit → sign in → enroll device → connect an AI host → inspect an authorized device → observe denied unsafe operation → execute an authorized action → receive a clear result and audit event. Repeat with a second account, offline device, revoked device, failed OAuth, keyboard-only navigation and a narrow viewport. Provider review and actual user acceptance cannot be replaced by fixture-based tests.

MCP Apps iframe UI is **optional**; the hosted dashboard is not an embedded ChatGPT or Claude MCP App and should not be represented as one.
