# Privacy Policy for ssh-mcp-pro

*Last updated: November 17, 2026*

This Privacy Policy explains how `ssh-mcp-pro` handles data when used as a Model Context Protocol (MCP) server, connector, or plugin with AI host platforms including OpenAI ChatGPT, Anthropic Claude, Google Gemini, and standalone MCP clients.

## 1. Zero Credential Exfiltration

- **SSH Keys and Credentials**: `ssh-mcp-pro` never collects, stores, or transmits your private SSH keys, passwords, passphrases, or bearer tokens to any AI model or external third-party server.
- **Local Key Isolation**: Key negotiation and authentication occur strictly between the local SSH client runtime and the target remote SSH server.

## 2. Command Output and Telemetry

- **Redaction**: Built-in redaction filters mask known secret patterns, private keys, authorization tokens, and credentials in command stdout/stderr and audit logs before results are returned to the client.
- **Diagnostics**: Operational telemetry (such as OpenTelemetry metrics and error codes) records request counts, latencies, and error codes without capturing remote command content or sensitive file contents.

## 3. Hosted OAuth and Control Plane

- When using the optional remote control plane (`ssh-mcp-pro` remote-agent or hosted dashboard):
  - Identity verification uses standard OAuth 2.0 / OIDC protocols (GitHub, Google).
  - Only authenticated user identifiers, device IDs, and policy profile names are stored.
  - No remote command histories or SSH session payloads are retained on central servers.

## 4. Third-Party Platforms

When interacting through host platforms (such as OpenAI, Anthropic, or Google), tool calls and outputs returned to the AI assistant are governed by the respective platform's privacy policy and data retention agreements.

## 5. Contact and Security Disclosures

For security vulnerabilities or privacy inquiries, please report via [GitHub Security Advisories](https://github.com/oaslananka/ssh-mcp-pro/security/advisories/new) or contact the maintainers via [GitHub Issues](https://github.com/oaslananka/ssh-mcp-pro/issues).
