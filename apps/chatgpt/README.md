# ChatGPT Plugin & MCP Server Integration

This directory provides validation scaffolding and readiness manifests for integrating `ssh-mcp-pro` with OpenAI ChatGPT and Codex environments following the official [OpenAI Plugins & MCP Server documentation](https://developers.openai.com/plugins).

OpenAI has unified developer tooling around the **Model Context Protocol (MCP)** and modern **ChatGPT Plugins**. Legacy Apps SDK paths redirect to the unified Plugin specifications.

## Architecture & Integration Paths

- **MCP Server Connection**: ChatGPT connects to `ssh-mcp-pro` using the Streamable HTTP transport at `https://<public-host>/mcp` or via local stdio runners (see [OpenAI MCP Server Guide](https://developers.openai.com/plugins/build/mcp-server) and [Quickstart](https://developers.openai.com/plugins/quickstart)).
- **ChatGPT UI / MCP Apps**: Interactive iframe UI widgets for host status, tunnel visualization, and mutation approvals conform to [ChatGPT UI development guidelines](https://developers.openai.com/plugins/build/chatgpt-ui).
- **Authentication**: Production deployment requires OAuth 2.0 with JWKS verification; local development supports bearer token authentication.
- **Tool Profile**: The default ChatGPT connector profile (`chatgpt`) exposes read-only inspection (`ssh_hosts_list`, `ssh_host_inspect`, `connector_status`) and safe planning (`ssh_policy_explain`, `ssh_mutation_plan`). Mutation and interactive shell tools remain hidden unless explicitly allowed by operator policy.

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

## Deployment & Submission

Before submitting to the ChatGPT plugin store:

1. Deploy the Streamable HTTP server behind HTTPS with a verified public domain per [Plugin Packaging](https://developers.openai.com/plugins/build/plugins).
2. Configure dedicated HTTPS Privacy Policy and Terms of Service endpoints.
3. Review submission checklist and compliance with [OpenAI Plugin Review Guidelines](https://developers.openai.com/plugins/deploy/app-review) and [Plugin Guidelines](https://developers.openai.com/plugins/plugin-guidelines).
4. Update `app-readiness.json` with domain verification proof and set `publishReady` to `true`.
