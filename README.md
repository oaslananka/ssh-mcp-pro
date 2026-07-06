<h1 align="center">ssh-mcp-pro</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/ssh-mcp-pro"><img alt="npm version" src="https://img.shields.io/npm/v/ssh-mcp-pro.svg" /></a>
  <a href="https://www.npmjs.com/package/ssh-mcp-pro"><img alt="npm downloads" src="https://img.shields.io/npm/dt/ssh-mcp-pro.svg" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="https://github.com/oaslananka/ssh-mcp-pro/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/oaslananka/ssh-mcp-pro/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://oaslananka.github.io/ssh-mcp-pro/"><img alt="API Docs" src="https://github.com/oaslananka/ssh-mcp-pro/actions/workflows/docs.yml/badge.svg" /></a>
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/oaslananka">
    <img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=oaslananka&button_colour=FFDD00&font_colour=000000&font_family=Arial&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" />
  </a>
</p>

ssh-mcp-pro is a secure Model Context Protocol (MCP) server for SSH automation. It lets MCP-capable clients open SSH sessions, inspect hosts, run guarded commands, manage files, transfer artifacts, create tunnels, and perform idempotent package or service work through policy-controlled tools.

## Prerequisites

- Node.js `>=22.22.2` or `>=24.15.0` or `>=26.3.0`
- pnpm `>=11.0.9`
- SSH access to the target hosts
- Docker, only for local integration tests and container image builds

## Installation

Install globally with pnpm:

```bash
pnpm add --global ssh-mcp-pro
ssh-mcp-pro --version
```

Run without a global install:

```bash
npx ssh-mcp-pro
```

For pnpm-only environments, use:

```bash
pnpm dlx ssh-mcp-pro
```

Container images are published to GitHub Container Registry for release tags:

```bash
docker run --rm ghcr.io/oaslananka/ssh-mcp-pro:1.0.0 --version
```

Images are published for `linux/amd64` and `linux/arm64` with exact semver and
Git tag aliases. Production deployments should prefer the digest-pinned
reference recorded by the release workflow. See [Docker Usage](docs/docker.md)
for the tag policy, digest-pinned examples, and registry verification steps.

## Quickstart

Generic stdio MCP config:

```json
{
  "name": "ssh-mcp-pro",
  "command": "ssh-mcp-pro",
  "type": "stdio"
}
```

VS Code settings style:

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

Claude Desktop style:

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "command": "ssh-mcp-pro",
      "args": []
    }
  }
}
```

After registration, start with discovery and a strict host-key policy:

```text
List configured SSH hosts, open a session to bastion.example.com as deploy with hostKeyPolicy=strict, then run os_detect.
```

## Usage

Use ssh-mcp-pro from an MCP client over stdio, or run the HTTP transport for
remote-safe connector profiles. Start with read-only discovery tools, inspect
the active policy, and create explicit sessions before running remote commands:

```text
List configured SSH hosts, explain the active SSH policy, connect to the selected host, then report its operating system and disk usage.
```

See [examples/README.md](examples/README.md) for additional workflows and
[INSTALL.md](INSTALL.md) for client-specific setup.

## Configuration

All `SSH_MCP_*` environment variables parsed by `src/config.ts` are listed below. Comma-separated settings also accept newline-separated values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SSH_MCP_MAX_SESSIONS` | `20` | Maximum concurrent SSH sessions. |
| `SSH_MCP_SESSION_TTL` | `900000` | Session time-to-live in milliseconds. |
| `SSH_MCP_COMMAND_TIMEOUT` | `30000` | Default remote command timeout in milliseconds. |
| `SSH_MCP_MAX_COMMAND_OUTPUT_BYTES` | `1048576` | Maximum buffered stdout/stderr bytes per command result. |
| `SSH_MCP_MAX_STREAM_CHUNKS` | `4096` | Maximum retained streaming chunks. |
| `SSH_MCP_MAX_FILE_SIZE` | `10485760` | Maximum bytes returned by text-focused file reads. |
| `SSH_MCP_MAX_FILE_WRITE_BYTES` | `10485760` | Maximum accepted write payload before buffering. |
| `SSH_MCP_MAX_TRANSFER_BYTES` | `52428800` | Maximum upload or download transfer size. |
| `SSH_MCP_DEBUG` | `false` | Enables debug-oriented configuration behavior. |
| `SSH_MCP_RATE_LIMIT` | `true` | Enables the global MCP request rate limiter. |
| `SSH_MCP_RATE_LIMIT_MAX` | `100` | Maximum requests per rate-limit window. |
| `SSH_MCP_RATE_LIMIT_PER_SESSION` | `true` | Enables per-session MCP request rate limiting when tool arguments include `sessionId`. |
| `SSH_MCP_RATE_LIMIT_PER_SESSION_MAX` | `50` | Maximum requests per SSH session per rate-limit window. |
| `SSH_MCP_RATE_LIMIT_PER_SESSION_WINDOW_MS` | `60000` | Per-session rate-limit window in milliseconds. |
| `SSH_MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds. |
| `SSH_MCP_STRICT_HOST_KEY` | unset | Legacy boolean alias for strict vs insecure host-key checking. |
| `SSH_MCP_HOST_KEY_POLICY` | `strict` | Host-key mode: `strict`, `accept-new`, or `insecure`. |
| `SSH_MCP_KNOWN_HOSTS_PATH` | `~/.ssh/known_hosts` | Known hosts file used for strict host-key verification. |
| `SSH_MCP_ALLOW_ROOT_LOGIN` | `false` | Allows SSH login as root and mirrors into policy. |
| `SSH_MCP_ALLOWED_CIPHERS` | empty | Optional SSH cipher allowlist. |
| `SSH_MCP_POLICY_FILE` | unset | JSON file containing partial policy overrides. |
| `SSH_MCP_POLICY_MODE` | `enforce` | Policy decision mode: `enforce` or `explain`. |
| `SSH_MCP_ALLOW_RAW_SUDO` | `false` | Allows raw `proc_sudo`; prefer `ensure_*` tools. |
| `SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS` | `false` | Allows commands matching destructive command policy. |
| `SSH_MCP_ALLOW_DESTRUCTIVE_FS` | `false` | Allows destructive filesystem operations such as `fs_rmrf`. |
| `SSH_MCP_ALLOWED_HOSTS` | empty | Host allowlist for policy and remote connector safety checks. |
| `SSH_MCP_COMMAND_ALLOW` | empty | Command allow patterns. |
| `SSH_MCP_COMMAND_DENY` | empty | Command deny patterns. |
| `SSH_MCP_PATH_ALLOW_PREFIXES` | `/tmp,/var/tmp,/home,/Users` | Remote path prefixes allowed by filesystem policy. |
| `SSH_MCP_PATH_DENY_PREFIXES` | `/etc/sudoers,/etc/shadow,/etc/passwd,/boot,/dev,/proc` | Remote path prefixes denied by filesystem policy. |
| `SSH_MCP_LOCAL_PATH_ALLOW_PREFIXES` | OS temp directory | Local paths allowed for transfer operations. |
| `SSH_MCP_LOCAL_PATH_DENY_PREFIXES` | empty | Local paths denied for transfer operations. |
| `SSH_MCP_TUNNEL_ALLOW_BIND_HOSTS` | `127.0.0.1,localhost,::1` | Local bind hosts allowed for tunnels. |
| `SSH_MCP_TUNNEL_DENY_BIND_HOSTS` | `0.0.0.0,::` | Local bind hosts denied for tunnels. |
| `SSH_MCP_TUNNEL_ALLOW_REMOTE_HOSTS` | empty | Optional remote tunnel target host allowlist. |
| `SSH_MCP_TUNNEL_DENY_REMOTE_HOSTS` | empty | Optional remote tunnel target host denylist. |
| `SSH_MCP_TUNNEL_ALLOW_PORTS` | empty | Optional tunnel port allowlist. |
| `SSH_MCP_TUNNEL_DENY_PORTS` | empty | Optional tunnel port denylist. |
| `SSH_MCP_HTTP_HOST` | `127.0.0.1` | Streamable HTTP bind host. |
| `SSH_MCP_HTTP_PORT` | `3000` | Streamable HTTP bind port. |
| `SSH_MCP_HTTP_ALLOWED_ORIGINS` | `http://127.0.0.1,http://localhost` | Browser origins allowed for HTTP clients. |
| `SSH_MCP_HTTP_BEARER_TOKEN_FILE` | unset | Bearer token file for HTTP transport. Required for non-loopback bearer deployments. |
| `SSH_MCP_ENABLE_LEGACY_SSE` | `false` | Enables legacy SSE compatibility. |
| `SSH_MCP_HTTP_MAX_REQUEST_BODY_BYTES` | `1048576` | Maximum HTTP request body size. |
| `SSH_MCP_HTTP_MAX_SESSIONS` | `20` | Maximum active Streamable HTTP MCP sessions. Expired sessions are cleaned first; if capacity is still full, the oldest idle session is evicted so abandoned clients do not cause persistent 502s. Use `100` for ChatGPT/Cloudflare production deployments. |
| `SSH_MCP_HTTP_SESSION_IDLE_TTL_MS` | `900000` | HTTP MCP session idle timeout in milliseconds. Use `300000` for ChatGPT/Cloudflare production deployments where clients may abandon sessions without DELETE. |
| `SSH_MCP_HTTP_PUBLIC_URL` | unset | Stable public HTTPS MCP URL for protected resource metadata. |
| `SSH_MCP_HTTP_TRUST_PROXY` | `false` | Trust reverse proxy forwarded headers. |
| `SSH_MCP_TOOL_PROFILE` | `full` | Active tool exposure profile. |
| `SSH_MCP_CONNECTOR_PROFILE` | `full` | Alias for `SSH_MCP_TOOL_PROFILE`. |
| `SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER` | `none` | Credential provider: `none`, `agent`, or `command`. |
| `SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND` | unset | External credential command when provider is `command`. |
| `SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_ARGS` | empty | Arguments passed to the external credential command. |
| `SSH_MCP_CONNECTOR_CREDENTIAL_COMMAND_TIMEOUT_MS` | `5000` | Credential command timeout in milliseconds. |
| `SSH_MCP_CONNECTOR_DEFAULT_USERNAME` | unset | Default username for connector broker flows. |
| `SSH_MCP_HTTP_AUTH_MODE` | `bearer` | HTTP auth mode: `bearer` or `oauth`. |
| `SSH_MCP_OAUTH_ISSUER` | unset | Expected OAuth issuer. |
| `SSH_MCP_OAUTH_AUDIENCE` | unset | Expected OAuth audience. |
| `SSH_MCP_OAUTH_JWKS_URL` | unset | OAuth JWKS URL. |
| `SSH_MCP_OAUTH_RESOURCE` | unset | OAuth protected resource identifier. |
| `SSH_MCP_OAUTH_REQUIRED_SCOPES` | `ssh-mcp-pro.read` | Required OAuth scopes. |
| `SSH_MCP_OAUTH_ALLOWED_ALGORITHMS` | unset | Optional comma-separated JWT algorithm allowlist, for example `RS256,ES256`. When unset, the built-in OAuth verifier defaults are used. |
| `SSH_MCP_REMOTE_AGENT_MCP_PASSTHROUGH` | unset | When enabled with `1`, `true`, `yes`, or `on`, lets `/mcp` requests bypass the remote control plane and reach the Streamable HTTP MCP handler. Use only for connector routing migrations. |

The parser also accepts non-`SSH_MCP_*` compatibility aliases `PORT`, `KNOWN_HOSTS_PATH`, and `STRICT_HOST_KEY_CHECKING`.

## Tool Profiles

`full` exposes every registered tool, resource, and prompt. Every other profile uses an explicit per-profile allowset. `chatgpt` and `claude` currently expose the same baseline connector tools as `remote-safe`, with empty client-specific extension sets reserved for future additions.

| Profile | Exposed tools | Exposed resources | Exposed prompts |
| --- | --- | --- | --- |
| `full` | All SSH, process, filesystem, transfer, ensure, tunnel, connector, and system tools. | All runtime resources. | All prompts. |
| `remote-safe` | `connector_status`, `ssh_hosts_list`, `ssh_policy_explain`, `ssh_host_inspect`, `ssh_mutation_plan`. | `ssh-mcp-pro://capabilities/support-matrix`. | `inspect-host-capabilities`, `plan-mutation`. |
| `chatgpt` | Baseline remote connector tools plus an empty ChatGPT extension set. | Same remote connector subset as `remote-safe`. | Same remote connector subset as `remote-safe`. |
| `claude` | Baseline remote connector tools plus an empty Claude extension set. | Same remote connector subset as `remote-safe`. | Same remote connector subset as `remote-safe`. |
| `remote-readonly` | Same remote connector subset as `remote-safe`. | Same remote connector subset as `remote-safe`. | Same remote connector subset as `remote-safe`. |
| `remote-broker` | Same remote connector subset as `remote-safe`. | Same remote connector subset as `remote-safe`. | Same remote connector subset as `remote-safe`. |

## Security Defaults

ssh-mcp-pro starts with strict SSH host-key verification, denies root login, denies raw sudo, blocks destructive commands and filesystem operations unless policy allows them, and refuses non-loopback HTTP startup unless authentication, origins, public HTTPS URL, strict host-key verification, a remote-safe tool profile, and host allowlists are configured. See [SECURITY.md](SECURITY.md) for vulnerability reporting and [SECURITY_DECISIONS.md](SECURITY_DECISIONS.md) for the design rationale behind these defaults.

## More Documentation

- [INSTALL.md](INSTALL.md) covers full client setup and troubleshooting.
- [API reference](https://oaslananka.github.io/ssh-mcp-pro/) is generated from the published TypeScript entry points.
- [CHANGELOG.md](CHANGELOG.md) records release history in Keep a Changelog format.
- [AGENTS.md](AGENTS.md) describes agent-facing operational guidance.
- [examples/README.md](examples/README.md) contains workflow examples.
- [ARCHITECTURE.md](ARCHITECTURE.md) explains the major subsystems and ADRs.
- [REGISTRY_SUBMISSION.md](REGISTRY_SUBMISSION.md) tracks MCP Registry submission readiness.
- [docs/tutorials/getting-started.md](docs/tutorials/getting-started.md),
  [docs/how-to/](docs/how-to/README.md), [docs/reference/](docs/reference/README.md),
  and [docs/explanation/](docs/explanation/architecture.md) organize the docs above by
  task (tutorial, how-to, reference, explanation).
- [docs/troubleshooting.md](docs/troubleshooting.md) covers common failure modes.

## Project Health & Governance

- [GOVERNANCE.md](GOVERNANCE.md) describes how decisions are made today.
- [MAINTAINERS.md](MAINTAINERS.md) lists current maintainers.
- [ROADMAP.md](ROADMAP.md) tracks known process gaps and what's planned to close them.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) sets community expectations.
- [docs/repo-maturity-report.md](docs/repo-maturity-report.md) is an evidence-based
  audit of this repository's open-source and OpenSSF maturity, including what's not
  yet in place.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality gates, commit rules,
and pull request expectations. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

ssh-mcp-pro is available under the [MIT License](LICENSE).

## Agent plugin and runtime configuration

This repository owns the product-level agent plugin, MCP runtime configuration, and product-specific skills for `ssh-mcp-pro`. The central [`agent-tools`](https://github.com/oaslananka/agent-tools) repository should catalog this plugin, but the manifest and workflow instructions live here so they stay synchronized with the actual MCP server package.

| File | Purpose |
| --- | --- |
| [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) | Claude Code-valid product plugin manifest. |
| [`.mcp.json`](.mcp.json) | Claude Code project-local MCP server configuration. |
| [`.codex/config.example.toml`](.codex/config.example.toml) | Codex CLI MCP configuration example. |
| [`.vscode/mcp.example.json`](.vscode/mcp.example.json) | VS Code / GitHub Copilot workspace MCP configuration example. |
| [`opencode.example.jsonc`](opencode.example.jsonc) | OpenCode project MCP configuration example. |
| `.opencode/skills/` | OpenCode-native mirrored skill definitions. |
| [`docs/agent-runtime-config.md`](docs/agent-runtime-config.md) | Agent runtime setup and validation notes. |

Validate plugin packaging locally:

```bash
claude plugin validate .
```
