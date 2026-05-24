# Installation Guide - ssh-mcp-pro

## Quick Installation

### pnpm Installation (Recommended)

Install globally to use as a command-line tool:

```bash
pnpm add --global ssh-mcp-pro
```

Verify installation:

```bash
ssh-mcp-pro --version
```

## Codex Setup

Codex supports MCP servers through `~/.codex/config.toml` and the `codex mcp`
CLI. The commands below use the Codex CLI path and match the current Codex MCP
command shape.

Register the server with Codex:

```bash
codex mcp add ssh-mcp -- ssh-mcp-pro
```

If you do not want a global install, use:

```bash
codex mcp add ssh-mcp -- pnpm dlx ssh-mcp-pro
```

Verify the registration:

```bash
codex mcp list
codex mcp get ssh-mcp
```

Optional hardened setup:

```bash
codex mcp remove ssh-mcp
codex mcp add ssh-mcp --env SSH_MCP_HOST_KEY_POLICY=strict -- ssh-mcp-pro
```

### ssh-mcp-pro CLI Reference

`ssh-mcp-pro --help` prints the supported server entry points. The exact help
snapshot is included at the end of this guide for diff-based validation.

Server modes:

- `ssh-mcp-pro` starts the MCP server over stdio.
- `ssh-mcp-pro stdio` starts the MCP server over stdio.
- `ssh-mcp-pro http` starts the Streamable HTTP server.
- `ssh-mcp-pro --transport=http` starts the Streamable HTTP server.
- `ssh-mcp-pro --stdio` forces stdio mode.

Supported aliases:

- `-h` is equivalent to `--help`.
- `-v` is equivalent to `--version`.
- `ssh-mcp-pro --transport=stdio` is equivalent to `ssh-mcp-pro stdio`.

HTTP flags:

- `--host 127.0.0.1` sets the HTTP bind host.
- `--port 3000` sets the HTTP bind port.
- `--bearer-token-file /path/token` loads the HTTP bearer token from a file.
- `--enable-legacy-sse` enables the legacy SSE endpoints.
- `--tool-profile remote-safe` selects the exposed tool profile.
- `--connector-credential-provider agent` selects the connector credential
  provider.

### HTTP Transport

Use the HTTP transport when the MCP client connects over Streamable HTTP instead
of spawning a local stdio process. Bind to loopback unless the deployment also
sets the production HTTP security environment variables documented in
`README.md`.

Create a bearer token file with restrictive permissions:

```bash
install -m 700 -d /tmp/ssh-mcp-pro
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" \
  > /tmp/ssh-mcp-pro/bearer-token
chmod 600 /tmp/ssh-mcp-pro/bearer-token
```

Start the HTTP server:

```bash
ssh-mcp-pro \
  --transport=http \
  --host 127.0.0.1 \
  --port 3000 \
  --bearer-token-file /tmp/ssh-mcp-pro/bearer-token \
  --tool-profile remote-safe
```

When rate limiting is enabled, HTTP responses include
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
headers for the global MCP request budget.

Register that HTTP endpoint with Codex:

```bash
export SSH_MCP_HTTP_BEARER_TOKEN="$(cat /tmp/ssh-mcp-pro/bearer-token)"
codex mcp add ssh-mcp-http \
  --url http://127.0.0.1:3000/mcp \
  --bearer-token-env-var SSH_MCP_HTTP_BEARER_TOKEN
```

Optional HTTP flags:

- `--enable-legacy-sse` enables the legacy SSE endpoints for older clients.
- `--connector-credential-provider agent` enables connector credential lookup
  through enrolled remote agents.

### Tool Profiles

The `--tool-profile <profile>` flag limits exposed tools, resources, and prompts
for connector-oriented clients. Valid values are:

- `full`
- `remote-safe`
- `chatgpt`
- `claude`
- `remote-readonly`
- `remote-broker`

Use `remote-safe` for non-loopback HTTP deployments. The `full` profile is
limited to stdio or loopback-only development and test sessions.

### Remote Agent CLI

`ssh-mcp-pro-agent` runs the no-custody outbound agent used by the remote
control plane. A typical enrollment flow uses a one-time token created by the
control plane:

```bash
npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll \
  --server https://control.example.com \
  --token <one-time-token> \
  --alias prod-bastion
```

Run the enrolled agent:

```bash
npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run
```

Check enrollment status:

```bash
ssh-mcp-pro-agent status
```

Service helpers print platform-specific installation or removal instructions:

```bash
ssh-mcp-pro-agent install-service
ssh-mcp-pro-agent uninstall-service
```

## VS Code Setup

### 1. Install GitHub Copilot Extension

Make sure you have the GitHub Copilot extension installed in VS Code.

### 2. Configure MCP Server

Create or edit your MCP configuration file. You can do this in two ways:

#### Option A: VS Code Settings

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "MCP"
3. Add the following configuration:

```json
{
  "mcp.servers": {
    "ssh-mcp-pro": {
      "type": "stdio",
      "command": "ssh-mcp-pro",
      "args": []
    }
  }
}
```

#### Option B: MCP Configuration File

Create a `mcp.json` file in your workspace or user settings directory:

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "command": "ssh-mcp-pro",
      "args": [],
      "transport": {
        "type": "stdio"
      }
    }
  }
}
```

### 3. Restart VS Code

After configuring, restart VS Code to load the MCP server.

## GitHub Copilot Setup

GitHub Copilot can use MCP servers from VS Code, GitHub Copilot CLI, and
Copilot cloud agent contexts. Use the configuration location that matches the
client you are using.

### Copilot Chat in VS Code

For a repository-scoped setup that can be shared with the workspace, create
`.vscode/mcp.json`:

```json
{
  "servers": {
    "ssh-mcp-pro": {
      "type": "stdio",
      "command": "ssh-mcp-pro",
      "args": []
    }
  }
}
```

For a personal setup, run `MCP: Open User Configuration` from the VS Code
command palette and add the same `ssh-mcp-pro` server to the user `mcp.json`.
Older Copilot Chat documentation may refer to personal VS Code `settings.json`;
prefer the dedicated user MCP configuration when your VS Code version provides
it.

To verify the server, run `MCP: List Servers` from the command palette or open
Copilot Chat in Agent mode, select the tools button, and confirm `ssh-mcp-pro` is
listed. If the server is stopped, use the Start control shown in the MCP
configuration file.

### GitHub Copilot CLI and Cloud Agent

For GitHub Copilot CLI, a repository-level MCP configuration can live in
`.mcp.json` or `.github/mcp.json` and uses the `mcpServers` key:

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "type": "local",
      "command": "ssh-mcp-pro",
      "args": [],
      "tools": ["*"]
    }
  }
}
```

For a user-level Copilot CLI setup, run:

```bash
copilot mcp add ssh-mcp-pro --tools "*" -- ssh-mcp-pro
```

This writes the server to `~/.copilot/mcp-config.json`. Verify with:

```bash
copilot mcp list
copilot mcp get ssh-mcp-pro
```

For Copilot cloud agent on GitHub.com, add the same `mcpServers` shape in the
repository's Copilot Cloud agent MCP configuration and keep the `tools` field
explicit. After assigning an issue to Copilot, open the Copilot session logs and
expand the Start MCP Servers step to confirm the `ssh-mcp-pro` tools were
started.

The `codex mcp add` commands in the Codex Setup section remain correct for
Codex-based workspace agents and intentionally keep the existing `ssh-mcp`
Codex alias. For GitHub Copilot CLI, use `copilot mcp add`.

## Claude Desktop, Antigravity, and Other MCP Clients

For any MCP client that supports launching a stdio server, register `ssh-mcp-pro`
as the command.

Example `servers` schema:

```json
{
  "servers": {
    "ssh-mcp-pro": {
      "type": "stdio",
      "command": "ssh-mcp-pro",
      "args": []
    }
  }
}
```

Example `mcpServers` schema:

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "command": "pnpm",
      "args": ["dlx", "ssh-mcp-pro"]
    }
  }
}
```

Use whichever schema matches the client you are configuring.

## Usage with GitHub Copilot

Once configured, you can use natural language commands with GitHub Copilot:

### Basic SSH Operations
- "Connect to server 192.168.1.100 as admin using SSH key"
- "Open SSH session to my production server"
- "Close all SSH connections"

### Remote Commands
- "Run 'systemctl status nginx' on the server"
- "Check disk usage on remote server"
- "Execute 'whoami' command remotely"

### File Operations
- "Read the content of /etc/nginx/nginx.conf"
- "Write 'Hello World' to /tmp/test.txt on server"
- "List files in /var/log directory"
- "Check if /etc/config.ini exists"

### System Administration
- "Install htop package on Ubuntu server"
- "Start nginx service"
- "Restart apache2 service"
- "Add line 'PasswordAuthentication no' to /etc/ssh/sshd_config"

## Prerequisites

### System Requirements
- Node.js `22.22.2+` or `24.15.0+`
- VS Code with GitHub Copilot extension
- SSH access to target systems

### SSH Authentication Setup

#### SSH Key Authentication (Recommended)

1. Generate SSH key pair (if you don't have one):
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

2. Copy public key to target server:
```bash
ssh-copy-id user@server-ip
```

3. Place your private key in standard location:
- `~/.ssh/id_ed25519` (preferred)
- `~/.ssh/id_rsa`
- `~/.ssh/id_ecdsa`

#### Password Authentication

While supported, SSH key authentication is more secure:
```bash
# The tool will prompt for password when needed
```

#### SSH Agent

For additional security, use SSH agent:
```bash
# Start SSH agent
eval "$(ssh-agent -s)"

# Add your SSH key
ssh-add ~/.ssh/id_ed25519
```

## Troubleshooting

### Common Issues

#### SSH Connection Problems
```bash
# Test SSH connection manually first
ssh user@hostname

# Check SSH key permissions
chmod 600 ~/.ssh/id_*
chmod 700 ~/.ssh
```

#### MCP Server Not Loading
1. Check VS Code output panel for errors
2. Verify MCP configuration syntax
3. Ensure `ssh-mcp-pro` is in your PATH
4. Restart VS Code completely

#### Permission Denied
```bash
# Fix SSH key permissions
chmod 600 ~/.ssh/private_key
chmod 644 ~/.ssh/public_key.pub
```

#### Command Not Found
```bash
# Check if ssh-mcp-pro is installed globally
which ssh-mcp-pro

# Reinstall if needed
pnpm remove --global ssh-mcp-pro
pnpm add --global ssh-mcp-pro
```

### Debug Mode

Enable debug logging by setting environment variable:
```bash
LOG_LEVEL=debug ssh-mcp-pro
```

## Security Best Practices

### SSH Security
- Use SSH keys instead of passwords
- Regularly rotate SSH keys
- Use strong passphrases for SSH keys
- Limit SSH access by IP when possible

### Key Management
- Never commit SSH private keys to version control
- Use SSH agent for key management
- Monitor SSH access logs regularly

### MCP Security
- Only connect to trusted servers
- Review commands before execution
- Use least privilege principle for SSH users

## Development Setup

### Install from Source

```bash
# Clone repository
git clone https://github.com/oaslananka/ssh-mcp-pro.git
cd ssh-mcp-pro

# Install dependencies
pnpm install --frozen-lockfile

# Build project
pnpm run build

# Link for global use
pnpm link --global
```

### Running Tests

```bash
# Unit tests
pnpm test

# E2E tests (requires SSH server)
RUN_SSH_E2E=1 pnpm run test:e2e
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (error, warn, info, debug) | info |
| `SSH_MCP_HOST_KEY_POLICY` | Host-key verification policy: `strict`, `accept-new`, or `insecure` | strict |
| `SSH_MCP_KNOWN_HOSTS_PATH` | Known-hosts file used by strict verification | `~/.ssh/known_hosts` |
| `SSH_MCP_COMMAND_TIMEOUT` | Default command timeout in milliseconds | 30000 |
| `SSH_MCP_MAX_COMMAND_OUTPUT_BYTES` | Max retained stdout/stderr bytes per command | 1048576 |
| `SSH_MCP_MAX_STREAM_CHUNKS` | Max retained streaming chunks | 4096 |
| `SSH_MCP_MAX_TRANSFER_BYTES` | Max transfer size for upload/download tools | 52428800 |

## Support

### Getting Help
- GitHub Issues: https://github.com/oaslananka/ssh-mcp-pro/issues
- Documentation: https://github.com/oaslananka/ssh-mcp-pro#readme

### Contributing
- Fork the repository
- Create a feature branch
- Submit a pull request

## License

MIT License - Copyright (c) 2025 Osman Aslan (oaslananka)

See LICENSE file for full license text.

## CLI Help Snapshot

This snapshot mirrors `node dist/index.js --help` except for the version banner
above the usage block.

```text
Usage:
  ssh-mcp-pro             Start MCP server over stdio (default)
  ssh-mcp-pro stdio       Start MCP server over stdio
  ssh-mcp-pro http        Start Streamable HTTP server
  ssh-mcp-pro --transport=http Start Streamable HTTP server
  ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>
  ssh-mcp-pro-agent run        Run the no-custody outbound agent
  ssh-mcp-pro-agent status     Show local agent enrollment status
  ssh-mcp-pro --help      Show this help
  ssh-mcp-pro --version   Show version
  ssh-mcp-pro --stdio     Force stdio mode (default)
  ssh-mcp-pro --transport=http --host 127.0.0.1 --port 3000
  ssh-mcp-pro --transport=http --bearer-token-file /path/token --enable-legacy-sse
  ssh-mcp-pro --transport=http --tool-profile remote-safe
  ssh-mcp-pro --transport=http --connector-credential-provider agent

Examples:
  Run as MCP stdio server: ssh-mcp-pro
  Enroll remote agent: npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll --server <url> --token <token> --alias <alias>
  Run remote agent: npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run
  Claude/VS Code config snippet:
    { "servers": { "ssh-mcp": { "type": "stdio", "command": "ssh-mcp-pro", "args": [] }}}
  Debug: MCP_STDIO=1 ssh-mcp-pro
```
