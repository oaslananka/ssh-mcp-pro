---
name: remote-host-workflow
description: End-to-end remote host workflow for ssh-mcp-pro, including baseline inspection, controlled changes, validation, and handoff notes.
---

# Remote Host Workflow Skill

Use this skill for structured work on a remote host.

## Workflow

1. Define host, environment, scope, risk, and success criteria.
2. Collect baseline facts before making changes.
3. Build a step-by-step plan for any mutation.
4. Ask for approval before changing files, services, processes, permissions, packages, or tunnels.
5. Apply the smallest safe change.
6. Re-check the affected service or host state.
7. Return a handoff with actions, evidence, rollback, and next steps.
