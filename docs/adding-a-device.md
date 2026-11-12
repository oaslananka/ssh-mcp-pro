# Adding a device (agent enrollment)

This guide explains the professional, repeatable way to connect a new
machine ("device") to the ssh-mcp-pro control plane. You never edit the
database by hand — every device is onboarded with a one-time enrollment
token and a chosen capability profile.

## Mental model

- The **control plane** is the always-on HTTP/WebSocket service that ChatGPT
  (or any MCP client) talks to. It holds the agent registry, policies, and
  the audit log.
- An **agent** is a small outbound process running on each device. It dials
  the control plane over WebSocket and executes only the actions its policy
  allows. Devices never accept inbound connections.
- A **profile** is the capability set granted to an agent. It is chosen when
  the enrollment token is created, and can be changed later without
  re-enrolling.

## Profiles

| Profile      | Capabilities                                              | Use it for                       |
| ------------ | -------------------------------------------------------- | -------------------------------- |
| `read-only`  | host/system/log/audit read                               | Monitoring, safe default         |
| `operations` | read + service management + docker + file read           | Day-to-day administration        |
| `full-admin` | everything, including `shell.exec` and `sudo.exec`       | Full remote control of a machine |

Start with the least privilege a device needs. You can raise the profile
later (see [Changing a policy later](#changing-a-policy-later)).

## Step 1 — Create an enrollment token

### Option A: From the web dashboard (recommended)

On a deployed control plane with HTTPS and OAuth configured:

1. Open its HTTPS URL and choose **Sign in with GitHub** or **Sign in with Google**.
2. Select **Add Device**, enter the device alias, and choose a capability profile.
   Start with `read-only` unless you need additional permissions.
3. Choose **Generate Install Command**. The dashboard creates a short-lived,
   one-time token and displays **Linux**, **Windows**, and **npm** commands.
4. Copy the command for the target device and run it there. The Linux and
   Windows installer commands install the agent, enroll it, and configure
   startup; the npm command only enrolls and starts the process in that shell.

Treat a generated command as a secret: it contains a one-time enrollment
token. Do not share it in tickets, logs, chat messages, or screenshots. If
the token expires, generate a new one in the dashboard.

### Option B: From the HTTP API (automation)

For an OAuth access token carrying the `agents:admin` scope:

```bash
curl -sS -X POST "https://your-control-plane.example.com/api/agents/enrollment-tokens" \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"alias":"office-pc","requested_profile":"read-only"}'
```

The response includes `enrollment_token` and `commands.npm` / `commands.run`.
The npm commands do not install a background service. To install and
register a persistent service, use the platform installer in Step 2 with
that one-time token.

### Option C: From an authenticated MCP client

If your authenticated connector has the `agents:admin` scope, call
`create_enrollment_token` with an alias and requested profile. Use the
returned token with the installer in Step 2 or the returned npm commands.

## Step 2 — Run the bootstrap on the new device

The Linux/Windows bootstrap installs the package, enrolls the machine, and
registers startup so the agent reconnects after restarts. On Linux/WSL,
the user-mode installer automatically installs verified **Node 26 LTS** into
the user's private directory if Node.js/npm is missing or too old. It checks
the official Node.js release signature and SHA-256 checksum before using the
binary; no sudo, system-wide Node changes or additional commands are needed.
System-wide Linux services still require a trusted system-installed Node
runtime. On Windows, if Node.js is missing, the installer attempts to install
the official Active LTS through Windows Package Manager (WinGet). The
dashboard-generated command is the shortest path; the manual commands below
are alternatives if you already have a one-time token.

### Linux / WSL

**Same-device browser setup (recommended for Linux/WSL with a browser):**

From the authenticated dashboard's **Add Device** tab, copy the
**Linux / WSL: Set up with your browser** command and run it in the
device's own terminal. It installs a verified user-local Node LTS if needed,
installs the agent and prints an HTTPS approval link. Open that link in a
browser on the **same device** (including a Windows browser that can reach
WSL loopback), sign in, choose the initial policy and click **Approve This
Device**. The one-time enrollment token is handed directly to the agent's
temporary `127.0.0.1` listener; it is never copied to a chat, terminal
argument or browser URL. The listener accepts only the control-plane origin
plus a random one-time link challenge and expires after 10 minutes. Browser
privacy/localhost network protections must allow the connection. If the
browser is on another machine, use the existing manual command instead.

For **headless or remote-only devices**, the existing manually generated
one-time token and installation command remain supported:

```bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/ssh-mcp-pro/main/scripts/install-agent.sh -o install-agent.sh
bash install-agent.sh \
  --server https://your-control-plane.example.com \
  --token <one-time-token> \
  --alias office-pc
```

This creates a **user** systemd service and enables linger so it survives
logout and starts at boot. If enabling linger is denied, the installer now
reports **incomplete setup** instead of claiming success: the running agent
may disconnect when the user logs out. Ask an administrator to run
`sudo loginctl enable-linger <linux-username>`, then verify
`loginctl show-user <linux-username> -p Linger` reports `Linger=yes`.
This repair does **not** require a new enrollment token. Pass `--system`
(with `sudo`) to install a system-wide service instead.

### Windows (PowerShell)

```powershell
Invoke-RestMethod https://raw.githubusercontent.com/oaslananka/ssh-mcp-pro/main/scripts/install-agent.ps1 -OutFile install-agent.ps1
& ([scriptblock]::Create((Get-Content -LiteralPath ./install-agent.ps1 -Raw))) -Server 'https://your-control-plane.example.com' -Token '<one-time-token>' -Alias 'office-pc'
```

This registers a Scheduled Task that runs the agent at logon and restarts it
on failure. The dashboard's Windows one-liner is preferred: it downloads from
your authenticated HTTPS control plane and uses an in-memory script block,
so no machine-wide PowerShell execution-policy change is needed. The
installer invokes npm and the agent through their `.cmd` wrappers to avoid
blocked npm/agent `.ps1` shims. Review the installer source and only use a
trusted server. If Node.js is missing, WinGet will download and install
`OpenJS.NodeJS.LTS` from its official `winget` source, potentially prompting
for Windows administrator approval (UAC). Nothing bypasses that prompt. The
installer refreshes its own PATH and continues automatically when Node is
available. If WinGet is unavailable or the user declines installation, the
script exits with actionable guidance to install Node LTS from
https://nodejs.org/en/download and rerun the command. An *outdated* Windows Node
installation is not silently upgraded. On Linux/WSL, the user-scope fallback
also requires curl, tar, SHA-256 and GPG signature-verification tools; it
reports missing prerequisites rather than running unverified downloads.
The Node runtime and npm-installed agent are kept under
~/.local/share/ssh-mcp-pro/, outside system locations.

### Repair an existing Windows agent task

Earlier Windows installations may still have Task Scheduler's default 72-hour
process limit even though new installations now set unlimited runtime. If your
existing agent disconnects after a long uptime, open **administrator PowerShell**
and approve the normal UAC prompt. Run this **without re-enrolling**:

```powershell
Invoke-RestMethod https://raw.githubusercontent.com/oaslananka/ssh-mcp-pro/main/scripts/repair-agent-task.ps1 -OutFile repair-agent-task.ps1
& ([scriptblock]::Create((Get-Content -LiteralPath ./repair-agent-task.ps1 -Raw)))
```

The repair does not require a new enrollment token, does not reinstall Node or
npm, and does not restart the running agent. It verifies that the task runs
`ssh-mcp-pro-agent.cmd run`, then changes only `ExecutionTimeLimit` from
`PT72H` to `PT0S`. If the task already has unlimited runtime, it succeeds
without changes. If permissions are insufficient or the task looks unfamiliar,
it stops and reports an error instead of bypassing UAC or overwriting settings.
The existing restart-on-failure policy is preserved.

For a fully headless host that must run before any user logs in, run the agent
under a service manager such as NSSM instead.

## Step 3 — Verify

On the device:

```bash
ssh-mcp-pro-agent status
```

It prints the agent id, alias, server, and active profile. This checks local
enrollment, **not** live connectivity. In the dashboard, open **Enrolled
Devices** and verify the device reports **Live Online**. The audit log
should contain `enrollment_token_created` and `agent_connected`.

## Find files after connecting a device

Once a device is **Live Online** with an `operations` or explicitly
file-read-enabled policy, you can ask your MCP client:

> Find JSON configuration files on my connected device.

The hosted `file_search` tool needs the device alias and a `name_pattern`
such as `*.json` or `config`. You do not need to know the complete file path.
It searches the local policy's allowed folders by default, or you can specify
an allowed `root_path` to narrow the search. Results contain file paths only,
not file contents; use `file_read` to inspect a selected file afterward.

Searches default to depth 3 and up to 20 matches. At most 2,000 entries,
128 directories, depth 5 and 50 matches are considered per invocation.
Hidden files are excluded unless requested. The response marks incomplete
searches as truncated; narrow the root or pattern for more precise results.
The agent skips symbolic links and does not search paths denied by its local
policy. Read-only profiles do not gain file access automatically.

## Find a setting inside a file without knowing its location

When `files.read` is enabled, you can ask your AI client:

> On my connected device, find which configuration file contains
> `mode=advanced`, and show me where it appears.

The hosted `file_content_search` tool accepts `agent_id_or_alias` and a
literal `query`. It searches locally allowed folders, returning one matching
line number and a short snippet **per file**; it never edits files. You can
optionally restrict the filename with `name_pattern` (e.g. `*.ini`) or an
allowed `root_path`. The query is plain text, **not a regular expression**,
and is case-insensitive by default unless `case_sensitive: true` is passed.

One search examines at most 128 files of up to 128 KiB each, traverses at
most 128 directories and 2,000 entries, and returns at most 50 matches
(default 20). Depth defaults to 3 (maximum 5). Binary/invalid UTF-8 and
oversized files are skipped, hidden paths are excluded unless explicitly
requested, and symbolic links are not followed. A `truncated: true` result
means the scan or output limit was reached: narrow the filename/root and
search again. Long files can instead be inspected with paged `file_read`.

The control plane masks the search phrase in stored action metadata.
Matched snippets are still sent to the authenticated AI client, so avoid
requesting secrets or credentials unless they are genuinely needed.

## Preview and apply one precise file edit

On an authorized device, clients with **both** `files.read` and
`files.write` can call `file_replace` instead of overwriting a whole file.
Give it an existing path, an exact `old_text` snippet and a `new_text` value.
The default `dry_run: true` returns a short diff and `before_sha256`
**without changing the file**.

To apply, call the same tool with `dry_run: false` and
`expected_sha256` equal to the preview's `before_sha256`. It replaces
**exactly one** occurrence, stages the new content as a temporary file,
checks the file hash again just before replacing the original, and reports
`FILE_CONFLICT` if it has changed. Reinspect/repreview after a conflict.
This is a best-effort optimistic stale-write check, **not** an atomic
compare-and-swap guarantee against concurrent external writes.

The agent refuses ambiguous/missing matches, non-UTF-8 text, files over
1 MiB and edits that exceed its output limits. Files outside the local
allowlist and read-only profiles cannot use this tool. Normal
`file_write` remains unchanged for full-file edits.

## Follow a long-running command without keeping a terminal open

When the agent's `shell.exec` capability is enabled, you can ask an AI
client: *"Start the test runner on my enrolled device, show its output, send
input if it asks, and stop it when I tell you."* The agent exposes four
tools that operate on a **user-owned process session**:

1. `process_start`: provide `agent_id_or_alias` and `command`, optionally
   `cwd` and `max_runtime_seconds` (1–600; default 300). Save the returned
   `process_id`; the command runs on that device, not on the cloud server.
2. `process_read`: supply the same agent and process ID, plus a `cursor`
   (start at 0). It returns status, exit code, a bounded list of stdout/stderr
   chunks, and `next_cursor` for the next read.
3. `process_input`: send short stdin text or close stdin. Do not type
   passwords/tokens into shell commands or client conversations.
4. `process_stop`: terminate the process and its descendants when finished.

Sessions do not survive agent restart, disconnection or permission revocation.
A device supports up to four simultaneous managed processes; runtime and
output memory are bounded. When output exceeds the local 64 KiB ring buffer,
`dropped_before_cursor` indicates earlier content that can no longer be
retrieved. Finished process results are retained for at most two minutes.

The control plane masks managed command and stdin payloads in durable action
metadata; the AI client may still receive and display command output. This
tool does not elevate shell permissions or bypass the local device policy.

## Changing a policy later

Capabilities are server-authoritative and pushed live to a connected agent —
you do **not** re-enroll to change them. Use the proper management path so
the change is validated and audited:

```bash
curl -sS -X PATCH "https://your-control-plane.example.com/api/agents/<agent-id>/policy" \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"policy":{"profile":"full-admin"}}'
```

or call the `update_agent_policy` tool from an admin-scoped connector. The
control plane pushes a `policy.update` to the running agent within seconds; no
restart is required.

> Do not edit `data/sshautomator.db` directly to change capabilities. The
> database is an implementation detail; the API and tools are the supported
> interface and they keep the audit trail intact.

## Troubleshooting

- **`shell.exec` denied / tool call fails**: the agent profile is too low.
  Raise it with the policy API above. Read-only agents intentionally cannot
  run shell commands, and a connection cannot grant itself more access.
- **Agent shows offline**: check the service
  (`systemctl --user status ssh-mcp-pro-agent` on Linux, the Scheduled Task on
  Windows) and that the device can reach the control plane URL over HTTPS.
- **Enrollment fails with an expired token**: tokens are single-use and
  short-lived. An unused, never-connected pending device is removed after its
  token expires, by the control plane's existing periodic cleanup (once per
  minute). You can then generate a fresh command with the same alias; if the
  alias is still reserved, refresh the device list after the next cleanup.
  Already enrolled or revoked devices and the security audit remain intact.
- **WebSocket error on start**: confirm Node 22.22+ or 24+, DNS/TLS
  connectivity to the configured server, and that the agent has not been revoked.
