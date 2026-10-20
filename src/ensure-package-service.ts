import { createPackageManagerError } from "./errors.js";
import { logger } from "./logging.js";
import {
  SUPPORTED_PACKAGE_MANAGERS_HINT,
  sanitizePackageName,
  getRemoveCommand,
  getInstallCommand,
  getPackageCheckCommand,
  usesDirectPackageCommand,
} from "./ensure-pkg.js";
import type { ProcessService } from "./process.js";
import type { SessionManager } from "./session.js";
import type { PackageManager, PackageResult } from "./types.js";

/** Package-specific orchestration; public EnsureService entry point remains unchanged. */
export function createPackageEnsure({
  sessionManager,
  processService,
}: {
  sessionManager: Pick<SessionManager, "getSession" | "getOSInfo">;
  processService: Pick<ProcessService, "execCommand" | "execSudo">;
}) {
  async function checkPackageInstalled(
    sessionId: string,
    packageName: string,
    pm: PackageManager,
  ): Promise<boolean> {
    const checkCommand = getPackageCheckCommand(pm, packageName);
    if (!checkCommand) {
      return false;
    }

    try {
      const result = await processService.execCommand(sessionId, checkCommand);
      return result.code === 0;
    } catch {
      return false;
    }
  }

  async function ensurePackage(
    sessionId: string,
    packageName: string,
    state: "present" | "absent" = "present",
  ): Promise<PackageResult> {
    const safePackageName = sanitizePackageName(packageName);
    logger.debug("Ensuring package state", {
      sessionId,
      packageName: safePackageName,
      state,
    });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      const osInfo = await sessionManager.getOSInfo(sessionId);
      const pm = osInfo.packageManager;

      if (pm === "unknown") {
        throw createPackageManagerError(
          "No supported package manager found",
          SUPPORTED_PACKAGE_MANAGERS_HINT,
        );
      }

      logger.debug("Detected package manager", { sessionId, pm });
      const isInstalled = await checkPackageInstalled(sessionId, safePackageName, pm);

      if (state === "absent") {
        if (!isInstalled) {
          logger.info("Package already not installed", {
            sessionId,
            packageName: safePackageName,
          });
          return {
            ok: true,
            pm,
            code: 0,
            stdout: `Package ${safePackageName} is not installed`,
            stderr: "",
          };
        }

        const removeCommand = getRemoveCommand(pm, safePackageName);
        logger.debug("Removing package", {
          sessionId,
          packageName: safePackageName,
          command: removeCommand,
        });

        const result = usesDirectPackageCommand(pm)
          ? await processService.execCommand(sessionId, removeCommand)
          : await processService.execSudo(
              sessionId,
              removeCommand,
              undefined,
              undefined,
              undefined,
              {
                policyAction: "ensure.package",
                rawSudo: false,
                destructive: true,
              },
            );

        const packageResult: PackageResult = {
          ok: result.code === 0,
          pm,
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
        };

        if (result.code === 0) {
          logger.info("Package removed successfully", {
            sessionId,
            packageName: safePackageName,
          });
        } else {
          logger.error("Package removal failed", {
            sessionId,
            packageName: safePackageName,
            code: result.code,
          });
        }

        return packageResult;
      }

      if (isInstalled) {
        logger.info("Package already installed", {
          sessionId,
          packageName: safePackageName,
        });
        return {
          ok: true,
          pm,
          code: 0,
          stdout: `Package ${safePackageName} is already installed`,
          stderr: "",
        };
      }

      const installCommand = getInstallCommand(pm, safePackageName);
      logger.debug("Installing package", {
        sessionId,
        packageName: safePackageName,
        command: installCommand,
      });

      const result = usesDirectPackageCommand(pm)
        ? await processService.execCommand(sessionId, installCommand)
        : await processService.execSudo(
            sessionId,
            installCommand,
            undefined,
            undefined,
            undefined,
            {
              policyAction: "ensure.package",
              rawSudo: false,
            },
          );

      const packageResult: PackageResult = {
        ok: result.code === 0,
        pm,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      };

      if (result.code === 0) {
        logger.info("Package installed successfully", {
          sessionId,
          packageName: safePackageName,
        });
      } else {
        logger.error("Package installation failed", {
          sessionId,
          packageName: safePackageName,
          code: result.code,
        });
      }

      return packageResult;
    } catch (error) {
      logger.error("Failed to ensure package", {
        sessionId,
        packageName,
        state,
        error,
      });
      throw error;
    }
  }

  return ensurePackage;
}
