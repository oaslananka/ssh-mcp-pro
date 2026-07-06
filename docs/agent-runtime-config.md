# Agent Runtime Configuration

This document gives copyable configuration examples for running `ssh-mcp-pro` from popular MCP-capable agent runtimes.

## Claude Code

The repository includes `.claude-plugin/plugin.json`, `.mcp.json`, and product skills under `skills/`.

```bash
claude plugin validate .
claude --plugin-dir .
```

## Codex CLI

Copy `.codex/config.example.toml` into your Codex config and adjust environment values if needed.

## VS Code / GitHub Copilot

Use `.vscode/mcp.example.json` as a workspace MCP configuration example.

## OpenCode

Copy `opencode.example.jsonc` to `opencode.json`, or merge the `mcp` block into an existing OpenCode config. OpenCode skills are mirrored under `.opencode/skills/`.

## Generic MCP clients

```bash
npx ssh-mcp-pro
```

## Safety

`ssh-mcp-pro` can affect remote systems. Treat privileged, destructive, service-affecting, or persistent changes as requiring explicit human approval.
