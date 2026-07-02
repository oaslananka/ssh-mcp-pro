# Reference

Reference material is information-oriented: precise, exhaustive where practical, and
organized for lookup rather than reading start-to-finish. This index follows the
[Diátaxis](https://diataxis.fr/reference/) definition of "reference."

- [Environment variables](../../README.md#configuration) — the canonical
  `SSH_MCP_*` configuration table lives in the README so it stays next to the
  install/quickstart instructions; this reference doesn't duplicate it.
- [Tool profiles](../../README.md#tool-profiles) — which tools/resources/prompts each
  connector profile (`full`, `remote-safe`, `chatgpt`, `claude`, `remote-readonly`,
  `remote-broker`) exposes.
- [CLI reference](cli.md) — `ssh-mcp-pro` and `ssh-mcp-pro-agent` command-line flags.
- [Configuration reference](configuration.md) — the `SSH_MCP_*` table grouped by
  concern, pointing back to the canonical table in the README.
- [Compatibility reference](compatibility.md) — supported Node.js/pnpm/OS/container
  platforms and MCP transport/client compatibility.
- [MCP metadata](../../mcp.json) and [server metadata](../../server.json) — machine-readable
  capability and registry declarations.
- [Security defaults](../../SECURITY_DECISIONS.md) — the exact default-deny behaviors and
  why each exists.
