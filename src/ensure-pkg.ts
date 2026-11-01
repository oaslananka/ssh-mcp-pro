import { createBadRequestError, createPackageManagerError } from "./errors.js";
import type { PackageManager } from "./types.js";

export const SUPPORTED_PACKAGE_MANAGERS: readonly Exclude<PackageManager, "unknown">[] = [
  "apt",
  "dnf",
  "yum",
  "pacman",
  "apk",
  "zypper",
  "brew",
  "winget",
  "choco",
];
export const SUPPORTED_PACKAGE_MANAGERS_HINT = `Supported package managers: ${SUPPORTED_PACKAGE_MANAGERS.join(
  ", ",
)}`;

export function sanitizePackageName(name: string): string {
  const validPackageName = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/;

  if (!validPackageName.test(name)) {
    throw createBadRequestError(
      `Invalid package name: ${name}`,
      "Package names must start with alphanumeric and contain only letters, numbers, dots, dashes, underscores, or plus signs",
    );
  }

  const dangerousChars = /[;&|`$(){}[\]<>\\"'\n\r]/;
  if (dangerousChars.test(name)) {
    throw createBadRequestError(
      "Package name contains potentially dangerous characters",
      "Remove any shell special characters from the package name",
    );
  }

  return name;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`);
}

export function getRemoveCommand(pm: PackageManager, packageName: string): string {
  switch (pm) {
    case "apt":
      return `apt-get remove -y ${packageName}`;
    case "dnf":
      return `dnf remove -y ${packageName}`;
    case "yum":
      return `yum remove -y ${packageName}`;
    case "pacman":
      return `pacman -R --noconfirm ${packageName}`;
    case "apk":
      return `apk del ${packageName}`;
    case "zypper":
      return `zypper remove -y ${packageName}`;
    case "brew":
      return `brew uninstall ${packageName}`;
    case "winget":
      return `winget uninstall --id ${packageName} --exact --silent --accept-source-agreements --disable-interactivity`;
    case "choco":
      return `choco uninstall ${packageName} -y --no-progress`;
    default:
      throw createPackageManagerError(`Unsupported package manager: ${pm}`);
  }
}

export function getInstallCommand(pm: PackageManager, packageName: string): string {
  switch (pm) {
    case "apt":
      return `apt-get update && apt-get install -y ${packageName}`;
    case "dnf":
      return `dnf install -y ${packageName}`;
    case "yum":
      return `yum install -y ${packageName}`;
    case "pacman":
      return `pacman -S --noconfirm ${packageName}`;
    case "apk":
      return `apk add ${packageName}`;
    case "zypper":
      return `zypper install -y ${packageName}`;
    case "brew":
      return `brew install ${packageName}`;
    case "winget":
      return `winget install --id ${packageName} --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity`;
    case "choco":
      return `choco install ${packageName} -y --no-progress`;
    default:
      throw createPackageManagerError(`Unsupported package manager: ${pm}`);
  }
}

export function getPackageCheckCommand(
  pm: PackageManager,
  packageName: string,
): string | undefined {
  switch (pm) {
    case "apt":
      return `dpkg -l ${packageName} | grep -q '^ii'`;
    case "dnf":
    case "yum":
      return `${pm} list installed ${packageName}`;
    case "pacman":
      return `pacman -Q ${packageName}`;
    case "apk":
      return `apk info -e ${packageName}`;
    case "zypper":
      return `zypper se -i ${packageName}`;
    case "brew":
      return `brew list --versions ${packageName}`;
    case "winget":
      return `$idPattern = ${powerShellQuote(
        String.raw`(^|\s)${escapeRegExp(packageName)}(\s|$)`,
      )}; $package = winget list --id ${powerShellQuote(
        packageName,
      )} --exact --disable-interactivity; if ($LASTEXITCODE -eq 0 -and ($package -match $idPattern)) { exit 0 } exit 1`;
    case "choco":
      return `$package = choco list --exact ${powerShellQuote(
        packageName,
      )} --limit-output; if ($LASTEXITCODE -eq 0 -and ($package -like ${powerShellQuote(
        `${packageName}|*`,
      )})) { exit 0 } exit 1`;
    default:
      return undefined;
  }
}

export function usesDirectPackageCommand(pm: PackageManager): boolean {
  return pm === "brew" || pm === "winget" || pm === "choco";
}
