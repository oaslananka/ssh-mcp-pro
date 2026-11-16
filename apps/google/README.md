# Google Gemini & Connected Apps Integration

`ssh-mcp-pro` supports integrations across the Google ecosystem, including [Google Connected Apps Platform](https://developers.google.com/connected-apps/), Gemini Developer Mode (`gemini.google.com/devmode`), Vertex AI agents, and [Gemini CLI Extensions](https://geminicli.com/docs/extensions/).

## 1. Gemini CLI Extension

`ssh-mcp-pro` includes a root `gemini-extension.json` manifest conforming to [Gemini CLI Extensions specifications](https://geminicli.com/docs/extensions/writing-extensions/).

### Installation in Gemini CLI

```bash
# Install directly from the Gemini CLI extensions catalog or npm:
gemini ext install ssh-mcp-pro

# Or link locally for development:
gemini ext install .
```

This registers the `ssh-mcp-pro` stdio server with automatic AGENTS.md context loading.

## 2. Google Connected Apps Platform

- **Endpoint**: `https://ssh-mcp-pro.oaslananka.dev/mcp`
- **Protected Resource Metadata**: `https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-protected-resource`
- **Authorization Server**: `https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-authorization-server`
- **Transport**: `streamable-http`
- **Identity Providers**: Google OAuth 2.0 / OIDC (`accounts.google.com`), GitHub OAuth

### Setup in Gemini & Vertex AI

Configure an external tool or connected app with the public endpoint above using OAuth 2.0 authentication following [Google MCP Server Optimization](https://developers.google.com/connected-apps/mcp/server-optimization) and [Connected Apps Guidelines](https://developers.google.com/connected-apps/mcp/guidelines).

For local development or zero-cloud setups, use stdio mode with `npx ssh-mcp-pro` in an MCP client that supports local commands; see [Getting Started](../../docs/tutorials/getting-started.md).
