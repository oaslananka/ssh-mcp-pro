# Outbound Agent Activity Monitor

The outbound agent streams timestamped events to its terminal and a **local, rotating diagnostic log**. This is useful when a Windows Scheduled Task displays a connection window, when a service restarts, or when an agent fails to authenticate. The agent does not need to expose a new HTTP API for this.

## Live monitor

Open a separate PowerShell 7 (Windows) or terminal (Linux/macOS) under the **same operating-system account** as the installed agent:

```shell
ssh-mcp-pro-agent logs --follow
```

To display the most recent events without remaining attached:

```shell
ssh-mcp-pro-agent logs --tail 80
ssh-mcp-pro-agent status
```

During `ssh-mcp-pro-agent run`, the console also displays a compact connection panel and continuously appends activity. Each operation has a matching short request ID, operation name, safe command or file summary, duration, result, exit code (when applicable), and stdout/stderr line counts. The console highlights INFO, OK, WARN and ERROR with color when supported by the terminal; plain-text environments remain readable.

For richer diagnostics in a trusted **local console**, use:

```shell
ssh-mcp-pro-agent run --verbose
```

To additionally see bounded, best-effort redacted command, working-directory and output previews, opt in explicitly:

```shell
ssh-mcp-pro-agent run --verbose --show-commands --show-output
```

These two preview flags affect **only the currently running console**. They never put raw commands or output in the rotating JSONL history, but unknown secrets inside arbitrary commands/output cannot be reliably detected by a redactor. Use the preview flags only on a trusted, private terminal without screen-sharing or automatic terminal capture.

For a Windows Scheduled Task or other supervisor that invokes `run` without flags, the equivalent startup environment settings are `SSHAUTOMATOR_AGENT_LOG_DETAIL=verbose`, `SSHAUTOMATOR_AGENT_LOG_COMMANDS=1` and `SSHAUTOMATOR_AGENT_LOG_OUTPUT=1`. Restart the agent for changes to take effect. The default compact format intentionally displays only an allowlisted harmless command, a safe executable name, or an obscured command summary; sensitive file paths and arbitrary arguments remain hidden. The `logs --follow` viewer shows the safe persisted summaries, not raw preview data. The **transport-open** event means the WebSocket opened, while **agent-ready** appears only after the control plane acknowledges the agent identity. Policy updates, request start/completion, rejected or expired requests, connection errors and disconnects have distinct INFO / OK / WARN / ERROR labels.

## Log storage and privacy

- Windows: `%USERPROFILE%\.sshautomator\logs\agent-activity.jsonl` for the Scheduled Task's user.
- Linux/macOS: `~/.sshautomator/logs/agent-activity.jsonl` for the systemd or launchd user.
- Log files rotate at 512 KiB with two older archives (`.1` and `.2`), preventing indefinite growth. On Unix, the log directory and files are created with restrictive permissions.
- Records contain timestamps, event types and constrained safe descriptions (including a short request ID, a narrowly allowlisted harmless command or safe filename, and numeric result counts). **Arbitrary shell arguments, raw command output, SSH passwords, private keys, OAuth tokens, enrollment tokens and raw server error messages are never persisted.**
- The viewer reads only this local file. There is no log upload, remote log streaming endpoint or new background service. To troubleshoot a connection, inspect its recent events and the agent supervisor's own logs as needed.

## Windows Scheduled Task

The Windows installer registers `ssh-mcp-pro-agent run` as a Scheduled Task for the current account. A Scheduled Task may not open a visible console window on every Windows configuration. Use **a second PowerShell window** with `ssh-mcp-pro-agent logs --follow` for reliable live visibility. If you do not see log files, verify which account owns the Scheduled Task and whether that account has launched a version of the agent that includes the activity monitor.

Dashboard host, OS and architecture come from the signed agent hello and are exposed in `host_metadata`. The API's `policy_version` is the control plane's configured policy version, not an agent acknowledgement. Use the local agent activity log to check for a policy update or a version mismatch. A ready event confirms identity, not successful policy persistence. After updating the control plane and agent, the agent must have applied the requested policy version before it executes an action.
