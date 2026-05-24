# AGENTS.md - ssh-mcp-pro

Guidance for AI agents using `ssh-mcp-pro` v2.

## Quick Start

```json
{
  "name": "ssh-mcp-pro",
  "command": "ssh-mcp-pro",
  "type": "stdio"
}
```

## Secure Defaults

- Host-key verification is strict by default.
- Root SSH login is denied unless policy allows it.
- Raw `proc_sudo` is denied unless policy allows it.
- Destructive commands and filesystem operations are policy-controlled.
- Use `policyMode: "explain"` before mutations when you need a plan or user confirmation.

## Recommended Workflow

1. `ssh_list_configured_hosts` to discover aliases when useful.
2. `ssh_open_session` with `hostKeyPolicy: "strict"` or `expectedHostKeySha256`.
3. `os_detect` to learn platform capabilities.
4. Read `ssh-mcp-pro://policy/effective` before privileged or destructive work.
5. Use task tools: `fs_*`, `proc_exec`, `ensure_*`, `file_*`, `tunnel_*`.
6. `ssh_close_session` when work is complete.

## Explain Mode

Use explain mode when a request may mutate a remote host, change files, start or
stop services, install packages, open tunnels, or require user approval before
execution. Explain mode is a planning and policy-preview path; it is not a
permission bypass and it does not execute the requested mutation.

Use `policyMode: "explain"` when you need a non-mutating preview from normal SSH
tools. For example, `ssh_open_session` with `policyMode: "explain"` returns a
connection plan with `wouldConnect` instead of opening a live SSH connection.
Write, transfer, process, ensure, and tunnel tools that honor the session policy
mode return explain-only plans instead of performing the change.

Use `policyMode: "enforce"` only after the plan has been reviewed, the target
host and path are correct, strict host-key verification is active, and the
effective policy allows the concrete operation. Enforce mode is the default mode
for actual work.

Connector clients can use `ssh_policy_explain` before opening sessions or
running task tools. It evaluates an optional `hostAlias`, action class, command,
and path against policy, returns `executed: false`, includes the policy
decision, and marks non-inspection requests as requiring explicit user
confirmation.

Connector clients can use `ssh_mutation_plan` for remote changes that should be
planned without execution. It accepts `hostAlias`, `goal`, and an optional
category such as `package`, `service`, `file`, `command`, `tunnel`, or `other`.
The result includes `executed: false`, a policy decision, prerequisites that
must be true before execution, and operations that remain disallowed in remote
connector profiles.

Use the `plan-mutation` prompt when the user asks for a risky remote change and
you need the agent to produce a concise, reviewable plan first. The prompt
directs the agent to use explain mode or policy resources and to call out sudo
needs, destructive operations, path policy, rollback, commands, and files that
would change.

Concrete explain-to-enforce sequence:

1. `ssh_list_configured_hosts` to choose an allowed alias.
2. `ssh_policy_explain` with `hostAlias`, `action: "mutation"`, and the
   proposed command or path.
3. `ssh_mutation_plan` with `hostAlias`, `goal`, and the closest category.
4. `ssh_open_session` with `policyMode: "explain"` and strict host-key
   verification to confirm the connection plan.
5. Review the policy decision, target host, target path, rollback, and exact
   tool payload with the user or supervising workflow.
6. `ssh_open_session` again with `policyMode: "enforce"` only after approval.
7. Run the narrow task tool, such as `ensure_package`, `ensure_service`,
   `fs_write`, `patch_apply`, or `proc_exec`.
8. Verify the result with read-only inspection and then `ssh_close_session`.

## Tool Guidance

| Tool | Use |
|------|-----|
| `ssh_open_session` | Open a persistent SSH connection. Reuse one session per host per task. |
| `proc_exec` | Run non-interactive commands. Destructive patterns may be denied. |
| `proc_sudo` | Raw sudo only when policy explicitly permits it. Prefer `ensure_*`. |
| `proc_exec_stream` | Long-running commands or output that should stream. |
| `fs_read` | Text-focused reads with size limits. Use `file_download` for large files. |
| `fs_write` | Write text data. Policy may deny protected paths. |
| `fs_rmrf` | Destructive delete. Use explain mode and confirm before invoking. |
| `file_upload` / `file_download` | SFTP transfers with checksum verification. |
| `ensure_package` | Idempotent package install/remove. |
| `ensure_service` | Idempotent service state changes where supported. |
| `ensure_lines_in_file` | Idempotent line management. |
| `patch_apply` | Apply unified diffs with dry-run behavior. |
| `tunnel_*` | Real SSH local/remote forwarding. Close tunnels when finished. |

## Resources

- `ssh-mcp-pro://sessions/active`
- `ssh-mcp-pro://metrics/json`
- `ssh-mcp-pro://metrics/prometheus`
- `ssh-mcp-pro://ssh-config/hosts`
- `ssh-mcp-pro://policy/effective`
- `ssh-mcp-pro://audit/recent`
- `ssh-mcp-pro://capabilities/support-matrix`

## Prompts

- `safe-connect`
- `inspect-host-capabilities`
- `plan-mutation`
- `managed-config-change`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Opening a new session for every tool call | Reuse the existing `sessionId`. |
| Disabling host-key checks for production | Populate `known_hosts` or pin `expectedHostKeySha256`. |
| Using raw `proc_sudo` for package/service work | Prefer `ensure_package` or `ensure_service`. |
| Reading huge files with `fs_read` | Use `file_download`. |
| Treating BusyBox/dropbear as full Linux | Check `sftpAvailable` and support matrix first. |
