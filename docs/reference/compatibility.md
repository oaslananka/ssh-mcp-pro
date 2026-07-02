# Compatibility Reference

## Node.js

| Requirement | Value | Source |
| --- | --- | --- |
| Minimum supported range | `>=22.22.2 \|\| >=24.15.0 \|\| >=26.3.0` | `package.json` `engines.node` |
| CI matrix | Node 22, 24, 26 (`Unit Tests (Node 22/24/26)`) | `.github/workflows/ci.yml` |
| Local development / release builds | Node 24.15.0 / 26.3.0 | `CONTRIBUTING.md`, `release.yml` |

Note the gap between 22.22.2 and 24.15.0: Node 23.x is not supported (it was never an
LTS line). This is expected, not an oversight.

## Package manager

pnpm `^11.5.1`, enforced via `packageManager` in `package.json` and `engine-strict=true`.
npm/yarn are not supported installation paths for *developing* this repo (consumers
installing the published package via npm/npx are unaffected — see
[README.md#installation](../../README.md#installation)).

## Operating systems

| OS | Status | Evidence |
| --- | --- | --- |
| Linux | Passed | Primary CI target; SSH fixture-based integration/E2E tests |
| Windows | Passed | Dedicated `test:integration:windows` project; CI matrix includes a Windows Integration job |
| macOS | Needs human confirmation | Listed as a supported platform in `mcp.json` (`platforms: [linux, macos, windows]`) but no macOS-specific CI job was found — likely covered incidentally by the cross-platform Node.js/SSH code paths, not by a dedicated test |

## Container platforms

`linux/amd64`, `linux/arm64` — built and verified in `docker.yml` via Buildx + QEMU.

## MCP transport compatibility

| Transport | Status |
| --- | --- |
| stdio | Passed — default, used by all documented client configs |
| Streamable HTTP | Passed — `http`/`--transport=http`, with the non-loopback safety gate described in [SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md) |
| Legacy SSE | Partial — available behind `SSH_MCP_ENABLE_LEGACY_SSE` for compatibility, not the recommended path |

## MCP client compatibility

Documented configs exist for a generic stdio client, VS Code, and Claude Desktop (see
[README.md#quickstart](../../README.md#quickstart)) plus connector-shaped profiles for
ChatGPT and Claude remote connectors (`chatgpt`, `claude` tool profiles). See
[Tool Profiles](../../README.md#tool-profiles) for exactly what each profile exposes.
