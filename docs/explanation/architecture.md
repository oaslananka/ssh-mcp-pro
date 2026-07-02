# Explanation: Architecture

This page is explanation-oriented (the "why"), per
[Diátaxis](https://diataxis.fr/explanation/). For the authoritative system diagram,
component breakdown, and ADRs, see [ARCHITECTURE.md](../../ARCHITECTURE.md) — this page
doesn't duplicate that content, it frames it.

## Why an MCP server for SSH, specifically

Model Context Protocol gives an LLM client a structured, typed set of tools instead of
free-form shell access. ssh-mcp-pro's core design bet is that "give the model SSH" is
unsafe as a primitive, but "give the model a curated set of SSH-backed tools, each with
its own policy check" is a workable middle ground between "no remote access" and
"unrestricted remote shell." That bet is why the codebase has a dedicated `policy`/
`safety` layer sitting between tool dispatch and the SSH session, rather than tools
calling `node-ssh` directly.

## Why defaults are deny-by-default

Every default documented in [SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md) —
strict host-key verification, no root login, no raw `sudo`, no destructive commands or
filesystem operations — exists because the honest threat model for this project is "an
LLM-driven client with SSH credentials, potentially acting on ambiguous or adversarial
instructions." See [docs/security/threat-model.md](../security/threat-model.md) for the
full reasoning. Architecturally, this means the safety checks live close to the tool
registry (so no tool can bypass them by construction), not scattered per-tool.

## Why there's a separate "remote control plane"

`src/remote/*` and the `ssh-mcp-pro-agent` binary exist because not every deployment
wants the MCP server itself reachable from the public internet. The control plane lets
an operator run a broker that mediates access, so the SSH-capable server can stay on a
private network while remote clients (ChatGPT connectors, Claude connectors) talk to the
broker instead. See [docs/remote-mcp-hardening.md](../remote-mcp-hardening.md) for the
operational guide and [ARCHITECTURE.md](../../ARCHITECTURE.md) for where this sits in
the request flow.

## Why tool profiles exist

`SSH_MCP_TOOL_PROFILE` (`full`, `remote-safe`, `chatgpt`, `claude`,
`remote-readonly`, `remote-broker`) exists because "expose every tool" is the right
default for a trusted local stdio client, but the wrong default for a remote connector
serving a broader audience. Profiles are an allowlist, not a denylist, so adding a new
profile can never accidentally widen an existing one's exposure.
