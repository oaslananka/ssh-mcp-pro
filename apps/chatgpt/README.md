# ssh-mcp-pro · ChatGPT and Codex

This directory provides validation scaffolding and readiness manifests for integrating `ssh-mcp-pro` with OpenAI ChatGPT and Codex environments following the official [OpenAI Plugins & MCP Server documentation](https://developers.openai.com/plugins).

OpenAI has unified developer tooling around the **Model Context Protocol (MCP)** and modern **ChatGPT Plugins**. Legacy Apps SDK paths redirect to the unified Plugin specifications.

## Architecture & Integration Paths

- **MCP Server Connection**: ChatGPT connects to `ssh-mcp-pro` using the Streamable HTTP transport at `https://<public-host>/mcp` or via local stdio runners (see [OpenAI MCP Server Guide](https://developers.openai.com/plugins/build/mcp-server) and [Quickstart](https://developers.openai.com/plugins/quickstart)).
- **ChatGPT UI / MCP Apps**: This repository currently provides MCP tools and an independent web dashboard, not an embedded MCP Apps iframe. Embedded interactive widgets are optional future UX work, not a prerequisite for an MCP-only connector.
- **Authentication**: Production deployment requires OAuth 2.0 with JWKS verification; local development supports bearer token authentication.
- **Tool Profile**: The default ChatGPT connector profile (`chatgpt`) exposes read-only inspection (`ssh_hosts_list`, `ssh_host_inspect`, `connector_status`) and safe planning (`ssh_policy_explain`, `ssh_mutation_plan`). Mutation and interactive shell tools remain hidden unless explicitly allowed by operator policy.

## Portable plugin package (2026 universal format)

The portable package lives in [plugin/](./plugin/):

- plugin/plugin.json — canonical **ssh-mcp-pro** identity and OpenAI listing metadata
- plugin/mcp.json — remote Streamable HTTP server, OAuth via Dynamic Client Registration (DCR)
- plugin/assets/icon-512.png — the project icon

The repository-root mcp.json serves **legacy MCP registry consumers** and is deliberately not replaced. The portable bundle has no embedded secrets, hooks, or invented registered plugin IDs.

For a direct connection in ChatGPT Plugins, select **Add custom MCP server** and enter https://ssh-mcp-pro.oaslananka.dev/mcp. Authenticate through remote OAuth. The portable public listing defaults to `hosts:read`, `agents:read`, `status:read` only; it does not automatically request SSH write, shell or sudo permissions. Independently configured CLI/client profiles can request additional scopes under their existing policies. ChatGPT can cache an existing installed plugin's title; refresh/reconnect or update the saved title to **ssh-mcp-pro** after deployment. A server identity change does not retroactively rename a user-created ChatGPT plugin entry.

This is an MCP-only plugin; an embedded MCP Apps iframe is **not yet implemented**. Do not claim an interactive inline app or an approved directory listing. A portable package does not replace testing an actual registered MCP connection.

## Security Defaults

- Use read-only inspection as the default profile.
- Do not collect SSH private keys, passphrases, passwords, or bearer tokens through chat.
- Require user-managed host configs or pre-enrolled agent credential storage before connecting.
- Keep strict host-key verification active by default.
- Require host allowlists for app-visible use.
- Require policy authorization plus explicit user confirmation before executing remote changes or destructive operations.
- Require bearer/OAuth authentication and allowed-origin restrictions for non-loopback HTTP bindings.

## Validation & Local Testing

Run the local readiness check:

```bash
pnpm run validate:chatgpt-app
```

For a local ChatGPT connector dry-run that reads `.env` safely and validates public endpoints, allowed origins, profiles, host-key policies, and credentials:

```bash
pnpm run build
pnpm run start:chatgpt
```

The [review case draft](review-test-cases.json) contains five positive and three negative cases aligned with the read-only and explain-only tool profile. These are **prepared scenarios, not verified platform review runs**; live review evidence and demonstration recordings must be produced before submission.

## Deployment & Submission

Before submitting for ChatGPT plugin review:

1. Deploy the Streamable HTTP server behind HTTPS with a verified public domain per [Plugin Packaging](https://developers.openai.com/plugins/build/plugins).
2. Configure dedicated HTTPS Privacy Policy and Terms of Service endpoints.
3. Review submission checklist and compliance with [OpenAI Plugin Review Guidelines](https://developers.openai.com/plugins/deploy/app-review) and [Plugin Guidelines](https://developers.openai.com/plugins/plugin-guidelines).
4. Update `app-readiness.json` with domain verification proof and set `publishReady` to `true`.


**Publication status (November 17, 2026):** Connector and OAuth metadata validate locally, but publisher verification, public domain ownership attestation, client-side acceptance, review screenshots, privacy review, and platform review are not independently confirmed. The manifest intentionally keeps `publishReady: false`. The server provides the challenge endpoint only when `SSH_MCP_OPENAI_DOMAIN_CHALLENGE` is set to the exact portal-provided value. Do not claim approval or enable public enrollment merely to pass review.
