import { randomUUID } from "node:crypto";
import {
  createBadRequestError,
  createSudoError,
  createFilesystemError,
  createPatchError,
} from "./errors.js";
import { logger } from "./logging.js";
import { createPackageEnsure } from "./ensure-package-service.js";
import type { FsService } from "./fs-tools.js";
import type { ProcessService } from "./process.js";
import { resolveRemoteTempDir } from "./shell.js";
import type { SessionManager } from "./session.js";
import type { LinesInFileResult, PackageResult, PatchResult, ServiceResult } from "./types.js";

export interface EnsureService {
  ensurePackage(
    sessionId: string,
    packageName: string,
    state?: "present" | "absent",
  ): Promise<PackageResult>;
  ensureService(
    sessionId: string,
    serviceName: string,
    state: "started" | "stopped" | "restarted" | "enabled" | "disabled",
  ): Promise<ServiceResult>;
  ensureLinesInFile(
    sessionId: string,
    filePath: string,
    lines: string[],
    createIfMissing?: boolean,
    state?: "present" | "absent",
  ): Promise<LinesInFileResult>;
  applyPatch(sessionId: string, filePath: string, diff: string): Promise<PatchResult>;
}

export interface EnsureServiceDeps {
  sessionManager: Pick<SessionManager, "getSession" | "getOSInfo">;
  processService: Pick<ProcessService, "execCommand" | "execSudo" | "commandExists">;
  fsService: Pick<FsService, "readFile" | "writeFile" | "pathExists">;
}

function sanitizeServiceName(name: string): string {
  const validServiceName = /^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/;

  if (!validServiceName.test(name)) {
    throw createBadRequestError(
      `Invalid service name: ${name}`,
      "Service names must contain only letters, numbers, dots, dashes, underscores, colons, @, or path-safe instance names",
    );
  }

  return name;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const code = (error as { code?: unknown } | undefined)?.code;
  return code ? String(code) : "unknown error";
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === "EACCES" || code === "EPERM" || code === 13 || code === 1) {
    return true;
  }

  return /\b(EACCES|EPERM|permission|permission denied|access denied|operation not permitted)\b/iu.test(
    describeError(error),
  );
}

export function createEnsureService({
  sessionManager,
  processService,
  fsService,
}: EnsureServiceDeps): EnsureService {
  const ensurePackage = createPackageEnsure({ sessionManager, processService });

  async function ensureService(
    sessionId: string,
    serviceName: string,
    state: "started" | "stopped" | "restarted" | "enabled" | "disabled",
  ): Promise<ServiceResult> {
    const safeServiceName = sanitizeServiceName(serviceName);
    logger.debug("Ensuring service state", { sessionId, serviceName: safeServiceName, state });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      const osInfo = await sessionManager.getOSInfo(sessionId);
      const initSystem = osInfo.init;

      if (initSystem === "launchd") {
        throw createSudoError(
          "launchd services are not managed by this tool",
          "Use launchctl directly on macOS hosts",
        );
      }

      if (initSystem === "windows-service") {
        throw createSudoError(
          "Windows services are not managed by this tool",
          "Use sc.exe or PowerShell to manage Windows services",
        );
      }

      if (initSystem === "unknown") {
        throw createSudoError(
          "No supported init system found",
          "Supported init systems: systemd, service",
        );
      }

      logger.debug("Detected init system", { sessionId, initSystem });

      let command: string;
      if (initSystem === "systemd") {
        switch (state) {
          case "started":
            command = `systemctl start ${safeServiceName}`;
            break;
          case "stopped":
            command = `systemctl stop ${safeServiceName}`;
            break;
          case "restarted":
            command = `systemctl restart ${safeServiceName}`;
            break;
          case "enabled":
            command = `systemctl enable ${safeServiceName}`;
            break;
          case "disabled":
            command = `systemctl disable ${safeServiceName}`;
            break;
        }
      } else {
        switch (state) {
          case "started":
            command = `service ${safeServiceName} start`;
            break;
          case "stopped":
            command = `service ${safeServiceName} stop`;
            break;
          case "restarted":
            command = `service ${safeServiceName} restart`;
            break;
          case "enabled":
            command = `chkconfig ${safeServiceName} on || update-rc.d ${safeServiceName} enable`;
            break;
          case "disabled":
            command = `chkconfig ${safeServiceName} off || update-rc.d ${safeServiceName} disable`;
            break;
        }
      }

      const result = await processService.execSudo(
        sessionId,
        command,
        undefined,
        undefined,
        undefined,
        {
          policyAction: "ensure.service",
          rawSudo: false,
          destructive: ["stopped", "restarted", "disabled"].includes(state),
        },
      );
      const serviceResult: ServiceResult = { ok: result.code === 0 };

      if (result.code === 0) {
        logger.info("Service state changed successfully", {
          sessionId,
          serviceName: safeServiceName,
          state,
        });
      } else {
        logger.error("Service state change failed", {
          sessionId,
          serviceName: safeServiceName,
          state,
          code: result.code,
          stderr: result.stderr,
        });
      }

      return serviceResult;
    } catch (error) {
      logger.error("Failed to ensure service state", {
        sessionId,
        serviceName: safeServiceName,
        state,
        error,
      });
      throw error;
    }
  }

  async function ensureLinesInFile(
    sessionId: string,
    filePath: string,
    lines: string[],
    createIfMissing = true,
    state: "present" | "absent" = "present",
  ): Promise<LinesInFileResult> {
    logger.debug("Ensuring lines in file", {
      sessionId,
      filePath,
      lineCount: lines.length,
      state,
    });

    try {
      const osInfo = await sessionManager.getOSInfo(sessionId);

      async function writeFileWithPrivilegeFallback(
        content: string,
        destructive: boolean,
      ): Promise<void> {
        try {
          await fsService.writeFile(sessionId, filePath, content);
          return;
        } catch (directWriteError) {
          if (!isPermissionError(directWriteError)) {
            throw directWriteError;
          }

          const tempDir = resolveRemoteTempDir(osInfo);
          const baseTempDir = tempDir.replace(/\/+$/, "");
          const tempFile = `${baseTempDir}/ssh-mcp-${randomUUID()}.tmp`;

          try {
            await fsService.writeFile(sessionId, tempFile, content);
          } catch (tempWriteError) {
            throw createFilesystemError(
              `Failed to stage temporary file for ${filePath}`,
              `Direct write failed with ${describeError(
                directWriteError,
              )}; temporary write failed with ${describeError(tempWriteError)}`,
            );
          }

          const moveResult = await processService.execSudo(
            sessionId,
            `mv ${shellQuote(tempFile)} ${shellQuote(filePath)}`,
            undefined,
            undefined,
            undefined,
            {
              policyAction: "ensure.lines",
              rawSudo: false,
              path: filePath,
              destructive,
            },
          );

          if (moveResult.code !== 0) {
            throw createFilesystemError(
              `Failed to move temporary file to ${filePath}`,
              "Check file permissions and sudo access",
            );
          }
        }
      }

      let fileContent = "";
      let fileExists = false;

      if (await fsService.pathExists(sessionId, filePath)) {
        fileExists = true;
        fileContent = await fsService.readFile(sessionId, filePath);
      } else if (state === "absent") {
        logger.info("File does not exist, lines already absent", {
          sessionId,
          filePath,
        });
        return { ok: true, added: 0 };
      } else if (!createIfMissing) {
        throw createFilesystemError(`File ${filePath} does not exist and createIfMissing is false`);
      }

      const existingLines = fileContent.split("\n");

      if (state === "absent") {
        const filteredLines = existingLines.filter((line) => !lines.includes(line));

        if (filteredLines.length === existingLines.length) {
          logger.info("No lines to remove from file", { sessionId, filePath });
          return { ok: true, added: 0 };
        }

        const removedCount = existingLines.length - filteredLines.length;
        const newContent = filteredLines.join("\n");

        await writeFileWithPrivilegeFallback(newContent, true);

        logger.info("Lines removed from file successfully", {
          sessionId,
          filePath,
          removed: removedCount,
        });
        return { ok: true, added: -removedCount };
      }

      const missingLines = lines.filter((line) => !existingLines.includes(line));
      if (missingLines.length === 0) {
        logger.info("All lines already exist in file", { sessionId, filePath });
        return { ok: true, added: 0 };
      }

      const newContent = fileExists
        ? `${fileContent}\n${missingLines.join("\n")}`
        : missingLines.join("\n");

      await writeFileWithPrivilegeFallback(newContent, true);

      logger.info("Lines added to file successfully", {
        sessionId,
        filePath,
        added: missingLines.length,
      });
      return { ok: true, added: missingLines.length };
    } catch (error) {
      logger.error("Failed to ensure lines in file", {
        sessionId,
        filePath,
        state,
        error,
      });
      throw error;
    }
  }

  async function applyPatch(
    sessionId: string,
    filePath: string,
    diff: string,
  ): Promise<PatchResult> {
    logger.debug("Applying patch to file", { sessionId, filePath });

    try {
      const osInfo = await sessionManager.getOSInfo(sessionId);
      const hasPatch = await processService.commandExists(sessionId, "patch");
      if (!hasPatch) {
        throw createPatchError(
          "patch command not found on remote system",
          "Install patch utility or apply changes manually",
        );
      }

      const tempDir = resolveRemoteTempDir(osInfo);
      const baseTempDir = tempDir.replace(/\/+$/, "");
      const tempPatchFile = `${baseTempDir}/ssh-mcp-patch-${randomUUID()}.patch`;
      await fsService.writeFile(sessionId, tempPatchFile, diff);

      try {
        const testResult = await processService.execCommand(
          sessionId,
          `patch --dry-run -p0 ${shellQuote(filePath)} < ${shellQuote(tempPatchFile)}`,
        );

        if (testResult.code !== 0) {
          throw createPatchError(
            "Patch would fail to apply",
            `Patch test failed: ${testResult.stderr}`,
          );
        }

        const applyCommand = `patch -p0 ${shellQuote(filePath)} < ${shellQuote(tempPatchFile)}`;
        const directResult = await processService.execCommand(sessionId, applyCommand);
        const result =
          directResult.code === 0
            ? directResult
            : await processService.execSudo(
                sessionId,
                applyCommand,
                undefined,
                undefined,
                undefined,
                {
                  policyAction: "patch.apply",
                  rawSudo: false,
                  path: filePath,
                  destructive: true,
                },
              );

        const patchResult: PatchResult = {
          ok: result.code === 0,
          changed: result.code === 0,
        };

        if (result.code === 0) {
          logger.info("Patch applied successfully", { sessionId, filePath });
        } else {
          logger.error("Patch application failed", {
            sessionId,
            filePath,
            code: result.code,
            stderr: result.stderr,
          });
        }

        return patchResult;
      } finally {
        try {
          const cleanupCommand =
            osInfo.platform === "windows"
              ? `Remove-Item -Path ${shellQuote(tempPatchFile)} -Force -ErrorAction SilentlyContinue`
              : `rm -f ${shellQuote(tempPatchFile)}`;
          await processService.execCommand(sessionId, cleanupCommand);
        } catch (error) {
          logger.warn("Failed to clean up temporary patch file", {
            tempPatchFile,
            error,
          });
        }
      }
    } catch (error) {
      logger.error("Failed to apply patch", { sessionId, filePath, error });
      throw error;
    }
  }

  return {
    ensurePackage,
    ensureService,
    ensureLinesInFile,
    applyPatch,
  };
}
