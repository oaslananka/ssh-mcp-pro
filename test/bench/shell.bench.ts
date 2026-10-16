import { bench, describe } from "vitest";
import {
  buildRemoteCommand,
  buildRemoteCommandWithTimeout,
  buildSudoCommand,
} from "../../src/shell.js";
import type { OSInfo } from "../../src/types.js";

const linux: OSInfo = {
  platform: "linux",
  distro: "ubuntu",
  version: "24.04",
  arch: "x86_64",
  shell: "/bin/bash",
  packageManager: "apt",
  init: "systemd",
  defaultShell: "bash",
};

const windows: OSInfo = {
  platform: "windows",
  distro: "windows-server",
  version: "2022",
  arch: "x86_64",
  shell: "powershell",
  packageManager: "winget",
  init: "windows-service",
  defaultShell: "powershell",
};

const env: Record<string, string> = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => [`APP_VAR_${index}`, `value '${index}' with "quotes"`]),
);

const command = "grep -R 'needle' /srv/app/logs | awk '{print $1}' | sort | uniq -c";

describe("shell command building", () => {
  bench("posix command with env and cwd", () => {
    buildRemoteCommand(command, linux, "/srv/app/current", env);
  });

  bench("posix command with timeout", () => {
    buildRemoteCommandWithTimeout(command, linux, 30_000, "/srv/app/current", env);
  });

  bench("powershell command with env and cwd", () => {
    buildRemoteCommand(
      String.raw`Get-ChildItem -Recurse C:\Logs`,
      windows,
      String.raw`C:\Users\deploy`,
      env,
    );
  });

  bench("sudo command", () => {
    buildSudoCommand("systemctl restart 'my app'", linux, "/etc/systemd/system");
  });
});
