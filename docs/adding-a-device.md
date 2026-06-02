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

## Step 1 — Create an enrollment token (on the control plane side)

Tokens are one-time and short-lived. Pick the profile here.

### Option A: HTTP API

```bash
curl -sS -X POST "https://your-control-plane.example.com/api/agents/enrollment-tokens" \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"alias":"office-pc","requested_profile":"operations"}'
```

The response includes a one-time `enrollment_token` and a ready-to-paste
install command. The calling identity must have the `agents:admin` scope.

### Option B: From ChatGPT

If your connector has the `agents:admin` scope, ask it to call the
`create_enrollment_token` tool with the alias and requested profile. It
returns the same token and install command.

## Step 2 — Run the bootstrap on the new device

The bootstrap installs the package, enrolls the machine, and registers a
service so the agent reconnects on boot. It needs Node 22.22+ or 24+.

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
irm https://raw.githubusercontent.com/oaslananka/ssh-mcp-pro/main/scripts/install-agent.ps1 -OutFile install-agent.ps1
./install-agent.ps1 -Server https://your-control-plane.example.com -Token <one-time-token> -Alias office-pc
```

This registers a Scheduled Task that runs the agent at logon and restarts it
on failure. For a fully headless host that must run before any user logs in,
run the agent under a service manager such as NSSM instead.

## Step 3 — Verify

On the device:

```bash
ssh-mcp-pro-agent status
```

It prints the agent id, alias, server, and active profile. On the control
plane side the agent shows up as `online` in the fleet list, and the audit
log records `enrollment_token_created` and `agent_connected`.

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
- **WebSocket error on start**: the runtime is too old. Install Node 22.22+
  or 24+.
