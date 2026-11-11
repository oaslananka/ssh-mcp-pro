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
registers startup so the agent reconnects after restarts. It needs Node
22.22+ or 24+. The dashboard-generated command is the shortest path; the
manual commands below are alternatives if you already have a one-time token.

### Linux / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/ssh-mcp-pro/main/scripts/install-agent.sh -o install-agent.sh
bash install-agent.sh \
  --server https://your-control-plane.example.com \
  --token <one-time-token> \
  --alias office-pc
```

This creates a **user** systemd service and enables linger so it survives
logout and starts at boot. Pass `--system` (with `sudo`) to install a
system-wide service instead.

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
trusted server; a missing or outdated Node.js runtime still requires setup
before this command can succeed.

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
  short-lived. Create a fresh one and retry.
- **WebSocket error on start**: confirm Node 22.22+ or 24+, DNS/TLS
  connectivity to the configured server, and that the agent has not been revoked.
