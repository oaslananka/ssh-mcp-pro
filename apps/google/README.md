# Google Gemini & Vertex AI Extension Integration

`ssh-mcp-pro` provides a Streamable HTTP MCP endpoint with OAuth support for integrations with Gemini and Vertex AI clients. The public endpoint below is a **deployment target**, not evidence that a hosted service is running. The readiness manifest is intentionally marked `publishReady: false` until the public deployment and OAuth flow pass live acceptance.

## Architecture

- **Endpoint**: `https://ssh-mcp-pro.oaslananka.dev/mcp`
- **Protected Resource Metadata**: `https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-protected-resource`
- **Authorization Server**: `https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-authorization-server`
- **Transport**: `streamable-http`
- **Identity Providers**: Google OAuth 2.0 (`accounts.google.com`), GitHub OAuth

## Setup in Gemini / Vertex AI

Only after the control plane has been deployed should you configure an external tool / extension with the endpoint above and OAuth 2.0 authentication. First verify that the domain resolves, HTTPS is valid, the protected-resource and authorization-server metadata endpoints respond, and a complete sign-in and MCP tool call succeed. An unverified endpoint must not be presented as ready for end-user sign-in. Do not enter tokens or credentials into a broken or unexpected login page.

For local development or zero-cloud setups, use stdio mode with `npx ssh-mcp-pro` in an MCP client that supports local commands. This path does not require the hosted OAuth service; see [Getting Started](../../docs/tutorials/getting-started.md).
