<div class="docs-hero">
  <span class="docs-kicker">SSH MCP Pro · API reference</span>
  <h2>SSH automation, with control built in.</h2>
  <p>Integrate SSH workflows into MCP clients with strict host verification, scoped sessions and clear operational policies. Find the API you need without digging through configuration tables.</p>
  <div class="docs-hero-actions">
    <a href="https://oaslananka.github.io/ssh-mcp-pro/modules.html">Explore the API →</a>
    <a class="docs-action-quiet" href="#quickstart">Start in minutes</a>
  </div>
</div>

<div class="docs-tiles">
  <a class="docs-tile" href="#quickstart">
    <span class="docs-pill">01 · Start</span>
    <span class="docs-tile-title">Install & connect →</span>
    <span class="docs-tile-desc">Launch the stdio MCP server and add it to your client.</span>
  </a>
  <a class="docs-tile" href="https://oaslananka.github.io/ssh-mcp-pro/modules.html">
    <span class="docs-pill">02 · Reference</span>
    <span class="docs-tile-title">Browse modules →</span>
    <span class="docs-tile-desc">Explore public functions, classes, interfaces and types.</span>
  </a>
  <a class="docs-tile" href="https://github.com/oaslananka/ssh-mcp-pro/blob/main/docs/security/threat-model.md">
    <span class="docs-pill">03 · Safety</span>
    <span class="docs-tile-title">Understand the security model →</span>
    <span class="docs-tile-desc">Check session, host-key and command policy boundaries.</span>
  </a>
  <a class="docs-tile" href="https://github.com/oaslananka/ssh-mcp-pro">
    <span class="docs-pill">04 · Project</span>
    <span class="docs-tile-title">View the source →</span>
    <span class="docs-tile-desc">Read full guides, examples, release notes and contribute.</span>
  </a>
</div>

## Quickstart

Install the public package using Node.js 22.22.2 or newer:

```bash
npm install --global ssh-mcp-pro
ssh-mcp-pro --version
```

Register a **stdio MCP server** in a compatible MCP client:

```json
{
  "name": "ssh-mcp-pro",
  "command": "ssh-mcp-pro",
  "type": "stdio"
}
```

Each client has a different configuration file. Use the [installation and client-specific setup guide](https://github.com/oaslananka/ssh-mcp-pro/blob/main/INSTALL.md) to place the configuration correctly.

## First connection

Begin with read-only discovery and strict host-key verification. For example, ask your MCP client:

> List my configured SSH hosts, explain the active SSH policy, connect to a selected host with strict host-key verification, and report its operating system.

Remote mutations remain subject to policy. Review [secure defaults](https://github.com/oaslananka/ssh-mcp-pro#security-defaults) before enabling any write or privileged operations.

## Find your way around

The **left sidebar** lists API modules and symbols. **Search** in the top bar finds named members; the **right sidebar** (on wide screens) lists headings on the current page. Use the visible moon/sun control to switch appearance, or select OS/Light/Dark under Settings.

For environment variables, tool profiles, examples and troubleshooting, see the [main README](https://github.com/oaslananka/ssh-mcp-pro#configuration) and [repository documentation](https://github.com/oaslananka/ssh-mcp-pro/tree/main/docs).
