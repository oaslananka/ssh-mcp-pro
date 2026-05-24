# MCP Registry Submission

Published server name:

```text
io.github.oaslananka/ssh-mcp-pro
```

Package identifier:

```text
ssh-mcp-pro
```

## Checklist

- [x] `server.json` uses the `io.github.oaslananka/ssh-mcp-pro` namespace.
- [x] `mcp.json` and `registry/ssh-mcp-pro/mcp.json` match `package.json` name, version, and entrypoint.
- [x] Package metadata declares stdio transport and Node runtime.
- [x] Package metadata declares Linux, macOS, and Windows platforms.
- [x] Tool, resource, and prompt capabilities are declared.
- [x] `validate:mcp-metadata` checks local metadata consistency without requiring build artifacts.
- [ ] A versioned package has been published to npm.
- [ ] The MCP Registry latest record resolves for `io.github.oaslananka/ssh-mcp-pro`.
- [ ] Registry submission has been verified after the first published release.

## Local Validation

```bash
pnpm run validate:mcp-metadata
pnpm run sync-version -- --check
pnpm run build
pnpm pack --dry-run
```

## Notes

The registry workflow validates local metadata and accepts a missing public registry record before the first release. After npm publication, the workflow should confirm that the latest registry record resolves to `io.github.oaslananka/ssh-mcp-pro`.
