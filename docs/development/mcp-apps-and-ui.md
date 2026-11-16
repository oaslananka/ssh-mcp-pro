# MCP Apps & UI Integration (2026 Specification)

This document outlines the architecture for integrating **MCP Apps** (`ext-apps`), **ChatGPT UI**, and **Claude MCP Apps** with `ssh-mcp-pro`.

## Overview

The official [MCP Apps Specification (2026-01-26)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) and ecosystem platforms ([ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui), [Claude MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started)) enable MCP servers to render rich, sandboxed interactive UI widgets inside host applications.

## Use Cases for SSH MCP Pro

1. **Topology & Host Health Dashboard**:
   - Visualizing configured SSH hosts, ping latencies, and remote OS status in a responsive dashboard.
2. **Tunnel & Forwarding Monitor**:
   - Real-time display of active local/remote tunnels, listening ports, and throughput.
3. **Interactive Mutation Plan Approval**:
   - Instead of plain text JSON, rendering human-in-the-loop diff cards for proposed file edits, service restarts, and package installations. Operators review prerequisites, impacted paths, and click "Approve" directly within the chat UI.

## Component Contract & CSP

Interactive MCP Apps components execute in sandboxed iframes. Conforming components must declare Content Security Policy (CSP) headers:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
```

Host communication uses the standard JSON-RPC postMessage bridge:
- `mcp.app.ready`: Announces component initialization to the host.
- `mcp.app.callTool`: Component triggers an MCP tool call (e.g. `ssh_mutation_plan`).
- `mcp.app.onEvent`: Receives real-time state updates or streaming logs.

## Platform References

- Official MCP Apps Documentation: [https://apps.extensions.modelcontextprotocol.io/](https://apps.extensions.modelcontextprotocol.io/)
- MCP Apps SDK Repository: [https://github.com/modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps)
- OpenAI ChatGPT UI: [https://developers.openai.com/plugins/build/chatgpt-ui](https://developers.openai.com/plugins/build/chatgpt-ui)
- Anthropic Claude MCP Apps: [https://claude.com/docs/connectors/building/mcp-apps/getting-started](https://claude.com/docs/connectors/building/mcp-apps/getting-started)
