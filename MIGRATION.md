# Migration Guide

## 1.x

Version `1.0.0` is the initial public baseline for this repository. There are no earlier published package versions with a supported automated migration path.

When upgrading within `1.x`, preserve these compatibility expectations:

- Node.js must satisfy `^22.22.2 || ^24.15.0`.
- pnpm must satisfy `^11.0.9`.
- Existing stdio MCP client configs can continue to launch `ssh-mcp-pro` with no arguments.
- HTTP deployments should keep explicit authentication, allowed origins, host allowlists, strict host-key verification, and a remote-safe tool profile.

Future breaking changes should add a new section with required config, policy, or data migration steps before release.
