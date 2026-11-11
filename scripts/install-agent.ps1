<#
.SYNOPSIS
  Bootstrap a ssh-mcp-pro outbound agent on a Windows host.

.DESCRIPTION
  Installs the published package, enrolls this machine with a one-time
  enrollment token, and registers a Scheduled Task so the agent reconnects
  at logon and restarts if it stops. Run it once per new device.

  The agent capabilities are fixed by the profile chosen when the enrollment
  token is created on the control plane (read-only / operations / full-admin),
  not by this script.

.PARAMETER Server
  Control plane base URL (required).

.PARAMETER Token
  One-time enrollment token (required).

.PARAMETER Alias
  Agent alias shown in the fleet (default: computer name).

.PARAMETER Version
  Package version to install (default: latest).

.PARAMETER TaskName
  Scheduled Task name (default: ssh-mcp-pro-agent).

.EXAMPLE
  ./install-agent.ps1 -Server https://control-plane -Token <one-time-token>
#>

param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Alias = $env:COMPUTERNAME,
  [string]$Version = "latest",
  [string]$TaskName = "ssh-mcp-pro-agent"
)

$ErrorActionPreference = "Stop"

function Die($message) {
  Write-Error "install-agent: $message"
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "node is not installed (need Node 22.22+ or 24+)"
}
# npm installs both npm.ps1 and npm.cmd. PowerShell may select npm.ps1 even
# when the user's execution policy forbids running scripts; use CMD directly.
$npmCmd = (Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $npmCmd) { Die "npm.cmd was not found; install a supported Node.js release with npm" }

# WebSocket is exposed as a global from Node 22.22+ (and all of 23/24+).
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
$nodeMinor = [int](node -p "process.versions.node.split('.')[1]")
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 22)) {
  Die "Node $(node -v) is too old; install Node 22.22+ or 24+"
}

Write-Host "install-agent: installing ssh-mcp-pro@$Version globally"
& $npmCmd install -g "ssh-mcp-pro@$Version"
if ($LASTEXITCODE -ne 0) { Die "npm install failed" }

# Use the same CMD executable for enrollment and the scheduled background task.
# Unlike npm's PowerShell wrapper, this works under a restricted script policy.
$agentCmd = (Get-Command ssh-mcp-pro-agent.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $agentCmd) { Die "ssh-mcp-pro-agent.cmd not found on PATH after install" }

Write-Host "install-agent: enrolling as alias '$Alias'"
& $agentCmd enroll --server $Server --token $Token --alias $Alias
if ($LASTEXITCODE -ne 0) { Die "enrollment failed" }

# /d skips user AutoRun commands; /s ensures a quoted path survives /c.
$taskArguments = '/d /s /c ""{0}" run"' -f $agentCmd
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $taskArguments
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "ssh-mcp-pro outbound agent" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "install-agent: scheduled task '$TaskName' registered and started"
Write-Host "install-agent: done. Verify with: ssh-mcp-pro-agent status"
