/** Build copyable enrollment commands without weakening shell-argument boundaries. */
export function buildDashboardEnrollmentCommands(serverUrl: string, token: string, alias: string) {
  const quotePosix = (value: string): string => "'" + value.replaceAll("'", String.raw`'\''`) + "'";
  const quotePowerShell = (value: string): string => "'" + value.replaceAll("'", "''") + "'";
  const installerSh = `${serverUrl}/install-agent.sh`;
  const installerPs = `${serverUrl}/install-agent.ps1`;
  // Keep pipefail so an unsuccessful curl download never looks like a valid install.
  const curlScript = 'curl -fsSL "$1" | bash -s -- --server "$2" --token "$3" --alias "$4"';
  return {
    linux: `bash -o pipefail -c ${quotePosix(curlScript)} _ ${quotePosix(installerSh)} ${quotePosix(serverUrl)} ${quotePosix(token)} ${quotePosix(alias)}`,
    windows: `& ([scriptblock]::Create((Invoke-RestMethod -Uri ${quotePowerShell(installerPs)}))) -Server ${quotePowerShell(serverUrl)} -Token ${quotePowerShell(token)} -Alias ${quotePowerShell(alias)}`,
    npm: `npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent enroll --server ${quotePosix(serverUrl)} --token ${quotePosix(token)} --alias ${quotePosix(alias)} && npx --yes --package ssh-mcp-pro@latest ssh-mcp-pro-agent run`,
  };
}

// For a browser on the same device as the agent, no bearer credential is
// ever placed in the copied install command or shell argument list.
export function buildDashboardBrowserEnrollmentCommand(serverUrl: string): string {
  const quotePosix = (value: string): string => "'" + value.replaceAll("'", String.raw`'\''`) + "'";
  const source = serverUrl.replace(/\/+$/u, "") + "/install-agent.sh";
  const run = 'curl -fsSL "$1" | bash -s -- --server "$2" --browser';
  return `bash -o pipefail -c ${quotePosix(run)} _ ${quotePosix(source)} ${quotePosix(serverUrl)}`;
}
