---
name: ssh-operations
description: Controlled SSH operations workflow for ssh-mcp-pro covering host discovery, sessions, commands, files, services, logs, metrics, and safe approvals.
---

# SSH Operations Skill

Use this skill when an agent needs to inspect or operate remote hosts through `ssh-mcp-pro`.

## Workflow

1. Identify the target host and confirm it is reachable.
2. Treat the first pass as read-only diagnostics unless the user explicitly approves changes.
3. Prefer purpose-built SSH MCP tools for host, session, process, file, service, log, tunnel, and metric operations.
4. Before any file, service, privilege, tunnel, or process mutation, state the exact action, expected impact, and rollback path.
5. After every action, report evidence: target host, tool used, outcome, and remaining risk.

## Safety

Do not assume SSH access equals permission to modify production. Require explicit approval for privileged, destructive, service-affecting, or persistent changes.
