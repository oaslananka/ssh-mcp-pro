import { NodeSSH } from "node-ssh";
import { InitSystem, OSInfo, PackageManager, Platform, ShellType } from "./types.js";
import { logger } from "./logging.js";
import { createFilesystemError } from "./errors.js";

async function safeExec(
  ssh: NodeSSH,
  command: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await ssh.execCommand(command);
    return {
      code: result.code ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    logger.debug("OS detection command failed", { command, error });
    return { code: 1, stdout: "", stderr: String(error) };
  }
}

function normalizeWindowsPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.replaceAll("\\\\", "/").replaceAll("\\", "/");
}

function parseKeyValueLine(line: string): { key: string; value: string } | undefined {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex === -1) {
    return undefined;
  }

  return {
    key: line.slice(0, separatorIndex),
    value: line
      .slice(separatorIndex + 1)
      .replaceAll('"', "")
      .trim(),
  };
}

async function detectArchitecture(ssh: NodeSSH): Promise<string> {
  // Detect architecture
  const archResult = await safeExec(ssh, "uname -m");
  let arch = archResult.stdout.trim();
  if (!arch) {
    const winArch = await safeExec(
      ssh,
      'powershell -NoLogo -NoProfile -Command "$env:PROCESSOR_ARCHITECTURE"',
    );
    arch = winArch.stdout.trim();
  }
  if (!arch) {
    arch = "unknown";
  }

  return arch;
}

async function detectPlatform(ssh: NodeSSH): Promise<{ platform: Platform; version: string }> {
  let platform: Platform = "unknown";
  let version = "unknown";
  const unameResult = await safeExec(ssh, "uname -s");
  const uname = unameResult.stdout.trim().toLowerCase();

  if (uname.includes("linux")) {
    platform = "linux";
  } else if (uname.includes("darwin")) {
    platform = "darwin";
  } else if (uname.includes("windows")) {
    platform = "windows";
  }

  // Windows fallback detection (when uname is not available)
  if (platform === "unknown") {
    const winCheck = await safeExec(ssh, "cmd /c ver");
    if (winCheck.code === 0 && winCheck.stdout) {
      platform = "windows";
      version = winCheck.stdout.trim();
    }
  }

  // macOS detection fallback
  if (platform === "unknown") {
    const macCheck = await safeExec(ssh, "sw_vers -productName");
    if (macCheck.code === 0 && macCheck.stdout.toLowerCase().includes("mac")) {
      platform = "darwin";
    }
  }

  return { platform, version };
}

async function detectWindows(ssh: NodeSSH, arch: string, version: string): Promise<OSInfo> {
  const platform: Platform = "windows";
  const defaultShell: ShellType = "powershell";
  const psShell = await safeExec(ssh, "echo $env:SHELL");
  const shell = psShell.stdout.trim();
  const tempDir =
    normalizeWindowsPath(
      (await safeExec(ssh, 'powershell -NoLogo -NoProfile -Command "$env:TEMP"')).stdout.trim(),
    ) ?? "C:/Windows/Temp";

  let packageManager: PackageManager = "unknown";
  const wingetCheck = await safeExec(
    ssh,
    'powershell -NoLogo -NoProfile -Command "Get-Command winget -ErrorAction SilentlyContinue"',
  );
  if (wingetCheck.code === 0 && wingetCheck.stdout.toLowerCase().includes("winget")) {
    packageManager = "winget";
  } else {
    const chocoCheck = await safeExec(ssh, "choco -v");
    if (chocoCheck.code === 0) {
      packageManager = "choco";
    }
  }

  const osInfo: OSInfo = {
    platform,
    distro: "windows",
    version,
    arch,
    shell: shell !== "" ? shell : "powershell",
    packageManager,
    init: "windows-service",
    defaultShell,
    tempDir,
  };

  logger.debug("OS detection completed", osInfo);
  return osInfo;
}

function readReleaseFields(
  stdout: string,
  distroKey: string,
  versionKey: string,
  lowerDistro: boolean,
): { distro: string; version: string } {
  let distro = "unknown";
  let version = "unknown";
  for (const line of stdout.split("\n")) {
    const parsedLine = parseKeyValueLine(line);
    if (!parsedLine) {
      continue;
    }
    if (parsedLine.key === distroKey) {
      distro = lowerDistro ? parsedLine.value.toLowerCase() : parsedLine.value;
    }
    if (parsedLine.key === versionKey) {
      version = parsedLine.value;
    }
  }
  return { distro, version };
}

function isAsciiDigit(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 48 && code <= 57;
}

function firstDottedVersion(value: string): string | undefined {
  for (let index = 0; index < value.length; index++) {
    if (!isAsciiDigit(value, index)) {
      continue;
    }
    const start = index;
    while (isAsciiDigit(value, index)) {
      index++;
    }
    if (value[index] !== "." || !isAsciiDigit(value, index + 1)) {
      index--;
      continue;
    }
    index++;
    while (isAsciiDigit(value, index)) {
      index++;
    }
    return value.slice(start, index);
  }
  return undefined;
}

function parseLinuxRelease(
  command: string,
  stdout: string,
): { distro: string; version: string } | undefined {
  if (command === "cat /etc/os-release") {
    return readReleaseFields(stdout, "ID", "VERSION_ID", false);
  }
  if (command === "cat /etc/lsb-release") {
    return readReleaseFields(stdout, "DISTRIB_ID", "DISTRIB_RELEASE", true);
  }
  const output = stdout.toLowerCase();
  if (output.includes("red hat") || output.includes("rhel") || output.includes("centos")) {
    return { distro: "rhel", version: firstDottedVersion(stdout) ?? "unknown" };
  }
  if (output.includes("debian")) {
    return { distro: "debian", version: stdout.trim() };
  }
  return undefined;
}

async function detectLinuxDistro(ssh: NodeSSH): Promise<{ distro: string; version: string }> {
  const commands = [
    "cat /etc/os-release",
    "cat /etc/lsb-release",
    "cat /etc/redhat-release",
    "cat /etc/debian_version",
  ];

  for (const command of commands) {
    const result = await safeExec(ssh, command);
    if (result.code !== 0 || !result.stdout.trim()) {
      continue;
    }
    const parsed = parseLinuxRelease(command, result.stdout);
    if (parsed) {
      return parsed;
    }
  }
  return { distro: "unknown", version: "unknown" };
}

async function detectPackageManager(ssh: NodeSSH, platform: Platform): Promise<PackageManager> {
  let packageManager: PackageManager = "unknown";
  if (platform === "linux") {
    const packageManagers = [
      {
        command: "command -v apt-get || which apt-get",
        manager: "apt" as PackageManager,
      },
      {
        command: "command -v dnf || which dnf",
        manager: "dnf" as PackageManager,
      },
      {
        command: "command -v yum || which yum",
        manager: "yum" as PackageManager,
      },
      {
        command: "command -v pacman || which pacman",
        manager: "pacman" as PackageManager,
      },
      {
        command: "command -v apk || which apk",
        manager: "apk" as PackageManager,
      },
      {
        command: "command -v zypper || which zypper",
        manager: "zypper" as PackageManager,
      },
    ];

    for (const { command, manager } of packageManagers) {
      const result = await safeExec(ssh, command);
      if (result.code === 0) {
        packageManager = manager;
        break;
      }
    }
  } else if (platform === "darwin") {
    const brewResult = await safeExec(ssh, "command -v brew || which brew");
    if (brewResult.code === 0) {
      packageManager = "brew";
    }
  }

  return packageManager;
}

async function detectInitSystem(ssh: NodeSSH, platform: Platform): Promise<InitSystem> {
  let init: InitSystem = "unknown";
  if (platform === "linux") {
    const systemctlResult = await safeExec(ssh, "command -v systemctl || which systemctl");
    const serviceResult = await safeExec(ssh, "command -v service || which service");
    if (systemctlResult.code === 0) {
      init = "systemd";
    } else if (serviceResult.code === 0) {
      init = "service";
    }
  } else if (platform === "darwin") {
    init = "launchd";
  }

  return init;
}

/**
 * Detects OS information on the remote system
 */
export async function detectOS(ssh: NodeSSH): Promise<OSInfo> {
  logger.debug("Starting OS detection");

  try {
    const arch = await detectArchitecture(ssh);

    const { platform, version: initialVersion } = await detectPlatform(ssh);
    let distro = "unknown";
    let version = initialVersion;
    let defaultShell: ShellType = "unknown";
    let tempDir: string | undefined;

    // Detect shell
    if (platform === "windows") {
      return await detectWindows(ssh, arch, version);
    }

    const shellResult = await safeExec(ssh, "echo $SHELL");
    const shell = shellResult.stdout.trim().split("/").pop() ?? "unknown";

    if (platform === "linux") {
      ({ distro, version } = await detectLinuxDistro(ssh));
    }

    // macOS distro detection
    if (platform === "darwin") {
      const productName = await safeExec(ssh, "sw_vers -productName");
      const productVersion = await safeExec(ssh, "sw_vers -productVersion");
      const productNameValue = productName.stdout.trim();
      const productVersionValue = productVersion.stdout.trim();
      distro = productNameValue !== "" ? productNameValue : "macos";
      version = productVersionValue !== "" ? productVersionValue : "unknown";
      defaultShell = shell.includes("zsh") ? "sh" : "bash";
    }

    const packageManager = await detectPackageManager(ssh, platform);

    const init = await detectInitSystem(ssh, platform);

    tempDir = platform === "darwin" || platform === "linux" ? "/tmp" : tempDir;
    if (defaultShell === "unknown") {
      defaultShell = shell.includes("bash") ? "bash" : "sh";
    }

    const osInfo: OSInfo = {
      platform,
      distro,
      version,
      arch,
      shell,
      packageManager,
      init,
      defaultShell,
      ...(tempDir ? { tempDir } : {}),
    };

    logger.debug("OS detection completed", osInfo);
    return osInfo;
  } catch (error) {
    logger.error("Failed to detect OS information", { error });
    throw createFilesystemError(
      "Failed to detect OS information",
      "Ensure the SSH connection is working and the remote system responds to basic commands",
    );
  }
}
