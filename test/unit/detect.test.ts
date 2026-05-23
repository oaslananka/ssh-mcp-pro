import { describe, expect, jest, test } from "@jest/globals";
import { detectOS } from "../../src/detect.js";

type ExecResponse = {
  code?: number;
  stdout?: string;
  stderr?: string;
};

function createSSH(responses: Record<string, ExecResponse | Error>) {
  return {
    execCommand: jest.fn(async (command: string) => {
      const response = responses[command];
      if (response instanceof Error) {
        throw response;
      }

      return {
        code: response?.code ?? 1,
        stdout: response?.stdout ?? "",
        stderr: response?.stderr ?? "",
      };
    }),
  } as any;
}

describe("detectOS", () => {
  test("detects linux distributions from os-release", async () => {
    const ssh = createSSH({
      "uname -m": { code: 0, stdout: "x86_64\n" },
      "uname -s": { code: 0, stdout: "Linux\n" },
      "echo $SHELL": { code: 0, stdout: "/bin/bash\n" },
      "cat /etc/os-release": {
        code: 0,
        stdout: 'ID=ubuntu\nVERSION_ID="22.04"\n',
      },
      "command -v apt-get || which apt-get": { code: 0, stdout: "/usr/bin/apt-get\n" },
      "command -v systemctl || which systemctl": { code: 0, stdout: "/usr/bin/systemctl\n" },
      "command -v service || which service": { code: 1, stdout: "" },
    });

    const result = await detectOS(ssh);

    expect(result).toEqual(
      expect.objectContaining({
        platform: "linux",
        distro: "ubuntu",
        version: "22.04",
        packageManager: "apt",
        init: "systemd",
        defaultShell: "bash",
        tempDir: "/tmp",
      }),
    );
  });

  test("detects windows hosts with PowerShell fallbacks", async () => {
    const ssh = createSSH({
      "uname -m": { code: 0, stdout: "" },
      'powershell -NoLogo -NoProfile -Command "$env:PROCESSOR_ARCHITECTURE"': {
        code: 0,
        stdout: "AMD64\n",
      },
      "uname -s": { code: 1, stdout: "" },
      "cmd /c ver": { code: 0, stdout: "Microsoft Windows [Version 10.0.19045]\n" },
      "echo $env:SHELL": { code: 0, stdout: "" },
      'powershell -NoLogo -NoProfile -Command "$env:TEMP"': { code: 0, stdout: "C:\\Temp\n" },
      'powershell -NoLogo -NoProfile -Command "Get-Command winget -ErrorAction SilentlyContinue"': {
        code: 0,
        stdout: "winget\n",
      },
    });

    const result = await detectOS(ssh);

    expect(result).toEqual(
      expect.objectContaining({
        platform: "windows",
        distro: "windows",
        arch: "AMD64",
        packageManager: "winget",
        init: "windows-service",
        defaultShell: "powershell",
        tempDir: "C:/Temp",
      }),
    );
  });

  test("detects macOS hosts and brew", async () => {
    const ssh = createSSH({
      "uname -m": { code: 0, stdout: "arm64\n" },
      "uname -s": { code: 0, stdout: "Darwin\n" },
      "echo $SHELL": { code: 0, stdout: "/bin/zsh\n" },
      "sw_vers -productName": { code: 0, stdout: "macOS\n" },
      "sw_vers -productVersion": { code: 0, stdout: "14.5\n" },
      "command -v brew || which brew": { code: 0, stdout: "/opt/homebrew/bin/brew\n" },
    });

    const result = await detectOS(ssh);

    expect(result).toEqual(
      expect.objectContaining({
        platform: "darwin",
        distro: "macOS",
        version: "14.5",
        packageManager: "brew",
        init: "launchd",
        defaultShell: "sh",
        tempDir: "/tmp",
      }),
    );
  });

  test("detects Linux lsb-release, service init, and fallback shell", async () => {
    const ssh = createSSH({
      "uname -m": { code: 0, stdout: "aarch64\n" },
      "uname -s": { code: 0, stdout: "Linux\n" },
      "echo $SHELL": { code: 0, stdout: "/bin/sh\n" },
      "cat /etc/os-release": { code: 1, stdout: "" },
      "cat /etc/lsb-release": {
        code: 0,
        stdout: "DISTRIB_ID=Ubuntu\nDISTRIB_RELEASE=24.04\n",
      },
      "command -v apt-get || which apt-get": { code: 1, stdout: "" },
      "command -v dnf || which dnf": { code: 1, stdout: "" },
      "command -v yum || which yum": { code: 1, stdout: "" },
      "command -v pacman || which pacman": { code: 1, stdout: "" },
      "command -v apk || which apk": { code: 0, stdout: "/sbin/apk\n" },
      "command -v systemctl || which systemctl": { code: 1, stdout: "" },
      "command -v service || which service": { code: 0, stdout: "/usr/sbin/service\n" },
    });

    await expect(detectOS(ssh)).resolves.toEqual(
      expect.objectContaining({
        platform: "linux",
        distro: "ubuntu",
        version: "24.04",
        packageManager: "apk",
        init: "service",
        defaultShell: "sh",
      }),
    );
  });

  test("detects Red Hat and Debian fallback release files", async () => {
    const redHat = createSSH({
      "uname -m": { code: 0, stdout: "x86_64\n" },
      "uname -s": { code: 0, stdout: "Linux\n" },
      "echo $SHELL": { code: 0, stdout: "/bin/bash\n" },
      "cat /etc/os-release": { code: 1, stdout: "" },
      "cat /etc/lsb-release": { code: 1, stdout: "" },
      "cat /etc/redhat-release": { code: 0, stdout: "Red Hat Enterprise Linux 9.4\n" },
      "command -v apt-get || which apt-get": { code: 1, stdout: "" },
      "command -v dnf || which dnf": { code: 0, stdout: "/usr/bin/dnf\n" },
      "command -v systemctl || which systemctl": { code: 1, stdout: "" },
      "command -v service || which service": { code: 1, stdout: "" },
    });
    const debian = createSSH({
      "uname -m": { code: 0, stdout: "x86_64\n" },
      "uname -s": { code: 0, stdout: "Linux\n" },
      "echo $SHELL": { code: 0, stdout: "/bin/bash\n" },
      "cat /etc/os-release": { code: 1, stdout: "" },
      "cat /etc/lsb-release": { code: 1, stdout: "" },
      "cat /etc/redhat-release": { code: 1, stdout: "" },
      "cat /etc/debian_version": { code: 0, stdout: "debian 12.5\n" },
      "command -v apt-get || which apt-get": { code: 1, stdout: "" },
      "command -v dnf || which dnf": { code: 1, stdout: "" },
      "command -v yum || which yum": { code: 1, stdout: "" },
      "command -v pacman || which pacman": { code: 0, stdout: "/usr/bin/pacman\n" },
      "command -v systemctl || which systemctl": { code: 1, stdout: "" },
      "command -v service || which service": { code: 1, stdout: "" },
    });

    await expect(detectOS(redHat)).resolves.toEqual(
      expect.objectContaining({
        distro: "rhel",
        version: "9.4",
        packageManager: "dnf",
      }),
    );
    await expect(detectOS(debian)).resolves.toEqual(
      expect.objectContaining({
        distro: "debian",
        version: "debian 12.5",
        packageManager: "pacman",
      }),
    );
  });

  test("detects macOS via fallback and Windows with Chocolatey", async () => {
    const mac = createSSH({
      "uname -m": { code: 0, stdout: "arm64\n" },
      "uname -s": { code: 1, stdout: "" },
      "cmd /c ver": { code: 1, stdout: "" },
      "sw_vers -productName": { code: 0, stdout: "Mac OS X\n" },
      "echo $SHELL": { code: 0, stdout: "/bin/bash\n" },
      "sw_vers -productVersion": { code: 0, stdout: "" },
      "command -v brew || which brew": { code: 1, stdout: "" },
    });
    const windows = createSSH({
      "uname -m": { code: 0, stdout: "" },
      'powershell -NoLogo -NoProfile -Command "$env:PROCESSOR_ARCHITECTURE"': {
        code: 0,
        stdout: "",
      },
      "uname -s": { code: 0, stdout: "Windows_NT\n" },
      "echo $env:SHELL": { code: 0, stdout: "pwsh\n" },
      'powershell -NoLogo -NoProfile -Command "$env:TEMP"': { code: 0, stdout: "" },
      'powershell -NoLogo -NoProfile -Command "Get-Command winget -ErrorAction SilentlyContinue"': {
        code: 1,
        stdout: "",
      },
      "choco -v": { code: 0, stdout: "2.0.0\n" },
    });

    await expect(detectOS(mac)).resolves.toEqual(
      expect.objectContaining({
        platform: "darwin",
        distro: "Mac OS X",
        version: "unknown",
        packageManager: "unknown",
        defaultShell: "bash",
      }),
    );
    await expect(detectOS(windows)).resolves.toEqual(
      expect.objectContaining({
        platform: "windows",
        arch: "unknown",
        shell: "pwsh",
        packageManager: "choco",
        tempDir: "C:/Windows/Temp",
      }),
    );
  });

  test("falls back safely when commands fail", async () => {
    const ssh = createSSH({
      "uname -m": new Error("boom"),
      "uname -s": new Error("boom"),
      "cmd /c ver": { code: 1, stdout: "" },
      "sw_vers -productName": { code: 1, stdout: "" },
      "echo $SHELL": { code: 1, stdout: "" },
    });

    const result = await detectOS(ssh);

    expect(result.platform).toBe("unknown");
    expect(result.arch).toBe("unknown");
    expect(result.packageManager).toBe("unknown");
  });
});
