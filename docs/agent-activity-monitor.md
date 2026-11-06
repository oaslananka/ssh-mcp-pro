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

During `ssh-mcp-pro-agent run`, the console also displays a compact connection panel and continuously appends activity. The **transport-open** event means the WebSocket opened, while **agent-ready** appears only after the control plane acknowledges the agent identity. Policy updates, request start/completion, rejected or expired requests, connection errors and disconnects have distinct INFO / OK / WARN / ERROR labels.

## Log storage and privacy

- Windows: `%USERPROFILE%\.sshautomator\logs\agent-activity.jsonl` for the Scheduled Task's user.
- Linux/macOS: `~/.sshautomator/logs/agent-activity.jsonl` for the systemd or launchd user.
- Log files rotate at 512 KiB with two older archives (`.1` and `.2`), preventing indefinite growth. On Unix, the log directory and files are created with restrictive permissions.
- Records contain only timestamps, event types and safe diagnostic descriptions. **No command arguments, command output, SSH passwords, private keys, OAuth access tokens, enrollment tokens or raw server error messages** are recorded.
- The viewer reads only this local file. There is no log upload, remote log streaming endpoint or new background service. To troubleshoot a connection, inspect its recent events and the agent supervisor's own logs as needed.

## Windows Scheduled Task

The Windows installer registers `ssh-mcp-pro-agent run` as a Scheduled Task for the current account. A Scheduled Task may not open a visible console window on every Windows configuration. Use **a second PowerShell window** with `ssh-mcp-pro-agent logs --follow` for reliable live visibility. If you do not see log files, verify which account owns the Scheduled Task and whether that account has launched a version of the agent that includes the activity monitor.

Dashboard host, OS, architecture and policy version are sent by the agent and exposed by the server under the JSON fields `host_metadata` and `policy_version`. The web UI consumes those fields directly rather than expecting camelCase properties.
