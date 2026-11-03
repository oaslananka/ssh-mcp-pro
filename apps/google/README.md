# Google Gemini & Vertex AI Extension Integration

`ssh-mcp-pro` connects directly to Google Gemini and Vertex AI agents through the standard Streamable HTTP transport and OAuth 2.1 PKCE authorization.

## Architecture

- **Endpoint**: `https://ssh-mcp-pro.oaslananka.dev/mcp`
- **Protected Resource Metadata**: `https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-protected-resource`
- **Authorization Server**: `https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-authorization-server`
- **Transport**: `streamable-http`
- **Identity Providers**: Google OAuth 2.0 (`accounts.google.com`), GitHub OAuth

## Setup in Gemini / Vertex AI

Add an external tool / extension pointing to `https://ssh-mcp-pro.oaslananka.dev/mcp` with OAuth 2.0 authentication.

For local development or zero-cloud setups, use stdio mode with `npx ssh-mcp-pro`.
