# Claude Plugin & Connector Integration

This directory packages `ssh-mcp-pro` as an Anthropic Claude Plugin and MCP Connector following the official [Claude Plugins Guide](https://claude.com/docs/plugins/build), [Claude Connectors Guide](https://claude.com/docs/connectors/building/index), and [Directory Publishing Guide](https://claude.com/docs/directory/publish).

Claude supports unified plugin packages bundling **MCP Connectors**, **Agent Skills**, and **MCP Apps**.

## Bundle Structure

- **Manifest**: `claude-plugin.json` specifies connector metadata, execution profiles, and agent skills.
- **Readiness Checklist**: `connector-readiness.json` manages marketplace compliance, OAuth configuration, and security baselines.
- **Skills**:
  - `skills/ssh-inspect/SKILL.md`: Guided read-only inspection workflow for host status and OS detection.
  - `skills/ssh-plan-mutation/SKILL.md`: Explain-first change management workflow preventing unapproved modifications.

## Security & Runtime Profile

Claude runs with the `claude` profile by default:
- Mutation tools (`proc_exec`, `proc_sudo`, `fs_write`, `fs_rmrf`) are hidden by default.
- Baseline tools expose safe host discovery (`ssh_hosts_list`), capability inspection (`ssh_host_inspect`), policy evaluation (`ssh_policy_explain`), and change planning (`ssh_mutation_plan`).
- Strict SSH host-key verification is enforced.
- Private keys and sensitive credentials are never entered or requested in chat.

## Local Testing with Claude Code

To run locally in Claude Code via stdio:

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "command": "npx",
      "args": ["-y", "ssh-mcp-pro@latest"]
    }
  }
}
```

Or connect via Streamable HTTP:

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

## Directory Publishing Checklist

Before submitting to the [Claude Directory](https://claude.ai/directory/manage):

1. Deploy the Streamable HTTP service behind a public HTTPS domain.
2. Configure OAuth 2.0 with JWKS verification.
3. Review `connector-readiness.json` and ensure dedicated HTTPS Privacy and Terms documents are referenced.
4. Run validation:
   ```bash
   pnpm run validate:claude-connector
   ```
