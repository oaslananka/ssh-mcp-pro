# ssh-mcp-pro Examples

These examples are written for v2 secure defaults. Start with discovery, open one session per host, inspect capabilities, then prefer structured tools over raw shell commands.

## Safe Connection

```text
Use the safe-connect prompt. Connect to prod-1.example.com as deploy with hostKeyPolicy=strict, then list active sessions.
```

For a lab host that is not in `known_hosts` yet:

```text
Open a session to lab-router as admin with hostKeyPolicy=accept-new, then run os_detect.
```

## Explain Before Mutating

```text
Open a session to web-1 as deploy with policyMode=explain. Plan how you would update /etc/nginx/nginx.conf to add gzip settings, including policy verdicts and rollback.
```

## Read And Inspect

```text
Connect to web-1 as deploy, run os_detect, read ssh-mcp-pro://policy/effective, then show df -h and uptime.
```

## File Operations

```text
Read /etc/nginx/nginx.conf with fs_read. If it is larger than the read limit, use file_download instead.
```

```text
List /var/log with fs_list, then read the newest nginx error log if it is within the configured file-size limit.
```

## Managed Configuration Change

```text
Use the managed-config-change prompt for /etc/ssh/sshd_config. Read the file, propose a minimal unified diff, dry-run the patch, then apply only if policy allows it.
```

## Package And Service Management

Prefer idempotent tools:

```text
Ensure htop is present on the host, then report whether anything changed.
```

```text
Ensure nginx is restarted only after checking policy and explaining the service impact.
```

## Transfers

```text
Upload ./release.tar.gz to /tmp/release.tar.gz with file_upload and report the SHA-256 verification result.
```

```text
Download /var/log/app/app.log to ./app.log with file_download and confirm checksum verification.
```

## Tunnels

```text
Create a local tunnel from localhost:15432 to remote database host db.internal:5432, list active tunnels, then close the tunnel when finished.
```

## BusyBox/dropbear Targets

```text
Connect to my embedded host, inspect whether SFTP is available, then use fs_stat and fs_list on /tmp. If a helper is unsupported, explain the capability gap.
```
