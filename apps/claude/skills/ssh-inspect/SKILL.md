---
name: ssh-inspect
description: Inspect remote host capabilities, OS details, and network topology safely using ssh-mcp-pro.
---

# SSH Host Inspection Skill

Use this skill when asked to check system health, verify remote host OS or hardware, list available SSH host aliases, or inspect remote services without mutating state.

## Workflow

1. Call `ssh_hosts_list` to list configured host aliases and connection endpoints.
2. Call `ssh_host_inspect` with `hostAlias` to probe remote OS, kernel version, default shell, and privilege level.
3. Call `connector_status` to verify active tunnels, session count, and policy constraints.
4. If checking platform capability limits, read the `ssh-mcp-pro://capabilities/support-matrix` resource.

## Guardrails

- Never execute arbitrary commands with raw sudo during inspection.
- Do not collect or print credentials, SSH private keys, or passwords.
