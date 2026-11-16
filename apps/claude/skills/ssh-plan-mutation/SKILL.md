---
name: ssh-plan-mutation
description: Generate safe, reviewable mutation plans for remote system changes before execution using ssh-mcp-pro.
---

# SSH Mutation Planning Skill

Use this skill before applying any mutation (package installation, service restart, configuration edit, file write, or tunnel creation) on a remote host.

## Workflow

1. Evaluate the proposed operation with `ssh_policy_explain`:
   - Pass `hostAlias`, `action: "mutation"`, and the proposed command or file path.
   - Confirm whether policy permits the action or requires explicit operator elevation.
2. Formulate a structured plan using `ssh_mutation_plan`:
   - Pass `hostAlias`, `goal`, and `category` (`package`, `service`, `file`, `command`, `tunnel`, or `other`).
   - Review prerequisites, rollback steps, and target paths.
3. Present the plan to the human supervisor for explicit confirmation.
4. Only after explicit operator approval, proceed with execution using the narrow idempotent task tool (`ensure_package`, `ensure_service`, `fs_write`, `patch_apply`).
