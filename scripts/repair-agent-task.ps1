<#
.SYNOPSIS
  Repair the legacy Windows agent Scheduled Task's 72-hour runtime limit.
.DESCRIPTION
  Run once in administrator PowerShell on an already enrolled machine.
  Changes only ExecutionTimeLimit from PT72H to PT0S; it does not install,
  enroll, restart, or stop an agent. UAC approval is never bypassed.
.PARAMETER TaskName
  Existing task name (default: ssh-mcp-pro-agent).
#>
[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$')]
  [string]$TaskName = "ssh-mcp-pro-agent"
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "repair-agent-task: Open administrator PowerShell and approve the normal UAC prompt. No task was changed."
  exit 1
}

try {
  $task = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" -ErrorAction Stop
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or
      [IO.Path]::GetFileName($actions[0].Execute) -ine "cmd.exe" -or
      $actions[0].Arguments -notmatch 'ssh-mcp-pro-agent\.cmd' -or
      $actions[0].Arguments -notmatch '\brun\b') {
    throw "The selected task is not a recognized ssh-mcp-pro outbound agent task."
  }

  $settings = $task.Settings
  if ($settings.ExecutionTimeLimit -eq "PT0S") {
    Write-Host "repair-agent-task: already configured for unlimited runtime."
    exit 0
  }
  if ($settings.ExecutionTimeLimit -ne "PT72H") {
    throw "Unexpected task timeout; refusing to replace a custom setting."
  }

  $preserve = @("RestartCount", "RestartInterval", "MultipleInstances",
    "DisallowStartIfOnBatteries", "StopIfGoingOnBatteries",
    "RunOnlyIfNetworkAvailable", "StartWhenAvailable", "AllowHardTerminate")
  $before = @{}
  foreach ($name in $preserve) {
    $before[$name] = [string]$settings.$name
  }

  $settings.ExecutionTimeLimit = "PT0S"
  Set-ScheduledTask -TaskName $TaskName -Settings $settings -TaskPath "\" -ErrorAction Stop | Out-Null
  $updated = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" -ErrorAction Stop
  if ($updated.Settings.ExecutionTimeLimit -ne "PT0S") {
    throw "The new runtime limit was not persisted."
  }
  foreach ($name in $preserve) {
    if ([string]$updated.Settings.$name -ne $before[$name]) {
      throw "A different task setting changed unexpectedly."
    }
  }
  Write-Host "repair-agent-task: unlimited runtime confirmed; agent and enrollment preserved."
} catch {
  Write-Error "repair-agent-task: repair failed; verify task identity and administrator permissions. No successful repair is claimed."
  exit 1
}
