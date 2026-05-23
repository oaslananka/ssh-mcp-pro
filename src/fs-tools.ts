import type { SFTPWrapper, Stats, FileEntry } from "ssh2";
import { randomUUID } from "node:crypto";
import { createFilesystemError, createLimitError, wrapError } from "./errors.js";
import { logger } from "./logging.js";
import { buildRemoteCommand } from "./shell.js";
import type { MetricsCollector } from "./metrics.js";
import type { PolicyEngine } from "./policy.js";
import type { SessionManager } from "./session.js";
import type { ServerConfig } from "./config.js";
import type { DirEntry, DirListResult, FileStatInfo } from "./types.js";
import { ErrorCode } from "./types.js";

export interface FsService {
  readFile(sessionId: string, path: string, encoding?: string, maxBytes?: number): Promise<string>;
  writeFile(sessionId: string, path: string, data: string, mode?: number): Promise<boolean>;
  statFile(sessionId: string, path: string): Promise<FileStatInfo>;
  listDirectory(
    sessionId: string,
    path: string,
    page?: number,
    limit?: number,
  ): Promise<DirListResult>;
  makeDirectories(sessionId: string, path: string): Promise<boolean>;
  removeRecursive(sessionId: string, path: string): Promise<boolean>;
  renameFile(sessionId: string, from: string, to: string): Promise<boolean>;
  pathExists(sessionId: string, path: string): Promise<boolean>;
  getFileSize(sessionId: string, path: string): Promise<number>;
  isDirectory(sessionId: string, path: string): Promise<boolean>;
  isFile(sessionId: string, path: string): Promise<boolean>;
}

export interface FsServiceDeps {
  sessionManager: Pick<SessionManager, "getSession" | "getOSInfo">;
  metrics: Pick<MetricsCollector, "recordFileRead" | "recordFileWrite" | "recordFileDelete">;
  config: Pick<ServerConfig, "maxFileSize" | "maxFileWriteBytes">;
  policy: Pick<PolicyEngine, "assertAllowed">;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function createDirListResult(entries: DirEntry[], nextToken?: string): DirListResult {
  return nextToken ? { entries, nextToken } : { entries };
}

function hasSftp(session: { sftp?: unknown } | undefined): boolean {
  return !!session?.sftp;
}

function tempPathFor(targetPath: string): string {
  const normalizedPath = targetPath.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const directory = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
  const baseName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const safeBaseName = baseName.length > 0 ? baseName : "write";
  return `${directory}.${safeBaseName}.${randomUUID()}.tmp`;
}

function getSftpOrThrow(session: { sftp?: SFTPWrapper }): SFTPWrapper {
  if (!session.sftp) {
    throw createFilesystemError("SFTP subsystem is unavailable for this session");
  }

  return session.sftp;
}

function sftpReadFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, (err: Error | null | undefined, data: Buffer) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

function sftpWriteFile(sftp: SFTPWrapper, path: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, data, {}, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function sftpStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err: Error | null | undefined, stats: Stats) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stats);
    });
  });
}

function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err: Error | null | undefined, list: FileEntry[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(list);
    });
  });
}

function sftpMkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(path, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function sftpChmod(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(path, mode, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function sftpMkdirRecursive(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  const parts = dirPath.split("/").filter((part) => part);
  let currentPath = dirPath.startsWith("/") ? "" : ".";

  for (const part of parts) {
    currentPath = currentPath === "" ? `/${part}` : `${currentPath}/${part}`;
    try {
      await sftpStat(sftp, currentPath);
    } catch {
      try {
        await sftpMkdir(sftp, currentPath);
      } catch (mkdirErr) {
        if ((mkdirErr as { code?: number } | undefined)?.code !== 4) {
          throw mkdirErr;
        }
      }
    }
  }
}

async function sftpRmdirRecursive(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  const entries = await sftpReaddir(sftp, dirPath);

  for (const entry of entries) {
    const entryPath = `${dirPath}/${entry.filename}`;
    const mode = entry.attrs.mode ?? 0;
    const isDir = (mode & 0o170000) === 0o040000;

    if (isDir) {
      await sftpRmdirRecursive(sftp, entryPath);
    } else {
      await sftpUnlink(sftp, entryPath);
    }
  }

  await sftpRmdir(sftp, dirPath);
}

const PORTABLE_STAT_FIELDS_COMMAND =
  'type=other; if [ -L "$target" ]; then type=symlink; elif [ -d "$target" ]; then type=directory; elif [ -f "$target" ]; then type=file; fi; size=$( (stat -c %s "$target" 2>/dev/null || stat -f %z "$target" 2>/dev/null || wc -c < "$target" 2>/dev/null) | tr -d " " | head -n 1); mtime=$( (stat -c %Y "$target" 2>/dev/null || stat -f %m "$target" 2>/dev/null || echo 0) | head -n 1); mode=$( (stat -c %a "$target" 2>/dev/null || stat -f %Lp "$target" 2>/dev/null || echo 0) | head -n 1)';
const PORTABLE_STAT_COMMAND = `${PORTABLE_STAT_FIELDS_COMMAND}; printf "%s\\t%s\\t%s\\t%s" "$type" "\${size:-0}" "\${mtime:-0}" "\${mode:-0}"`;

export function createFsService({
  sessionManager,
  metrics,
  config,
  policy,
}: FsServiceDeps): FsService {
  async function execFallback(sessionId: string, command: string): Promise<string> {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    const osInfo = await sessionManager.getOSInfo(sessionId);
    const shellCommand = buildRemoteCommand(command, osInfo);
    const result = await session.ssh.execCommand(shellCommand);

    if ((result.code ?? 0) !== 0) {
      throw new Error(
        result.stderr || result.stdout || `Remote command failed with code ${result.code}`,
      );
    }

    return result.stdout ?? "";
  }

  async function readFile(
    sessionId: string,
    path: string,
    encoding = "utf8",
    maxBytes?: number,
  ): Promise<string> {
    logger.debug("Reading file", { sessionId, path, encoding });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      policy.assertAllowed({
        action: "fs.read",
        path,
        mode: session.info.policyMode,
      });
      const effectiveMaxBytes = maxBytes ?? config.maxFileSize;
      const size = await getFileSizeInternal(sessionId, path);
      if (size > effectiveMaxBytes) {
        throw createLimitError(
          `File ${path} is ${size} bytes, which exceeds the ${effectiveMaxBytes} byte read limit`,
          "Use file_download for large files or raise SSH_MCP_MAX_FILE_SIZE intentionally.",
        );
      }

      if (!hasSftp(session)) {
        const data = await execFallback(sessionId, `cat ${shellQuote(path)}`);
        metrics.recordFileRead(Buffer.byteLength(data, "utf8"));
        logger.debug("File read successfully via SSH fallback", {
          sessionId,
          path,
          size: data.length,
        });
        return data;
      }

      const sftp = getSftpOrThrow(session);
      const data = await sftpReadFile(sftp, path);
      const result = data.toString(encoding as BufferEncoding);
      metrics.recordFileRead(data.length);
      logger.debug("File read successfully", {
        sessionId,
        path,
        size: result.length,
      });
      return result;
    } catch (error) {
      logger.error("Failed to read file", { sessionId, path, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to read file ${path}. Check if the file exists and is readable.`,
      );
    }
  }

  async function writeFile(
    sessionId: string,
    path: string,
    data: string,
    mode?: number,
  ): Promise<boolean> {
    logger.debug("Writing file", { sessionId, path, size: data.length, mode });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      const decision = policy.assertAllowed({
        action: "fs.write",
        path,
        mode: session.info.policyMode,
      });
      if (decision.mode === "explain") {
        return true;
      }

      const writeBytes = Buffer.byteLength(data, "utf8");
      if (writeBytes > config.maxFileWriteBytes) {
        throw createLimitError(
          `Write payload is ${writeBytes} bytes, which exceeds the ${config.maxFileWriteBytes} byte write limit`,
          "Use file_upload for large files or raise SSH_MCP_MAX_FILE_WRITE_BYTES intentionally.",
        );
      }

      if (!hasSftp(session)) {
        const tempPath = tempPathFor(path);
        const chmodCommand =
          mode !== undefined ? `chmod ${mode.toString(8)} ${shellQuote(tempPath)}\n` : "";

        await execFallback(
          sessionId,
          `printf %s ${shellQuote(data)} > ${shellQuote(tempPath)}\n${chmodCommand}mv ${shellQuote(tempPath)} ${shellQuote(path)}`,
        );

        metrics.recordFileWrite(writeBytes);
        logger.debug("File written successfully via SSH fallback", {
          sessionId,
          path,
        });
        return true;
      }

      const sftp = getSftpOrThrow(session);
      const tempPath = tempPathFor(path);
      const dataBuffer = Buffer.from(data, "utf8");

      try {
        await sftpWriteFile(sftp, tempPath, dataBuffer);

        if (mode !== undefined) {
          await sftpChmod(sftp, tempPath, mode);
        }

        await sftpRename(sftp, tempPath, path);
        metrics.recordFileWrite(writeBytes);

        logger.debug("File written successfully", { sessionId, path });
        return true;
      } catch (writeError) {
        try {
          await sftpUnlink(sftp, tempPath);
          logger.debug("Cleaned up temp file after error", { tempPath });
        } catch (cleanupError) {
          logger.warn("Failed to clean up temp file", {
            tempPath,
            cleanupError,
          });
        }
        throw writeError;
      }
    } catch (error) {
      logger.error("Failed to write file", { sessionId, path, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to write file ${path}. Check directory permissions and disk space.`,
      );
    }
  }

  async function statFileInternal(sessionId: string, path: string): Promise<FileStatInfo> {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    if (!hasSftp(session)) {
      const output = await execFallback(
        sessionId,
        `target=${shellQuote(path)}; ${PORTABLE_STAT_COMMAND}`,
      );

      const [type = "other", size = "0", mtime = "0", mode = "0"] = output.trim().split("\t");
      return {
        size: Number(size),
        mtime: new Date(Number(mtime) * 1000),
        mode: parseInt(mode, 8),
        type: type as FileStatInfo["type"],
      };
    }

    const sftp = getSftpOrThrow(session);
    const stats = await sftpStat(sftp, path);

    let type: FileStatInfo["type"] = "other";
    const mode = stats.mode ?? 0;

    if ((mode & 0o170000) === 0o100000) {
      type = "file";
    } else if ((mode & 0o170000) === 0o040000) {
      type = "directory";
    } else if ((mode & 0o170000) === 0o120000) {
      type = "symlink";
    } else if (typeof stats.isFile === "function") {
      if (stats.isFile()) {
        type = "file";
      } else if (stats.isDirectory()) {
        type = "directory";
      } else if (stats.isSymbolicLink?.()) {
        type = "symlink";
      }
    }

    const statInfo: FileStatInfo = {
      size: stats.size ?? 0,
      mtime: new Date(typeof stats.mtime === "number" ? stats.mtime * 1000 : Date.now()),
      mode,
      type,
    };

    logger.debug("File stats retrieved", {
      sessionId,
      path,
      type,
      size: stats.size,
    });
    return statInfo;
  }

  async function statFile(sessionId: string, path: string): Promise<FileStatInfo> {
    logger.debug("Getting file stats", { sessionId, path });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      policy.assertAllowed({
        action: "fs.stat",
        path,
        mode: session.info.policyMode,
      });

      return await statFileInternal(sessionId, path);
    } catch (error) {
      logger.error("Failed to get file stats", { sessionId, path, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to get stats for ${path}. Check if the path exists.`,
      );
    }
  }

  async function listDirectory(
    sessionId: string,
    path: string,
    page?: number,
    limit = 100,
  ): Promise<DirListResult> {
    logger.debug("Listing directory", { sessionId, path, page, limit });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      policy.assertAllowed({
        action: "fs.list",
        path,
        mode: session.info.policyMode,
      });

      if (!hasSftp(session)) {
        const output = await execFallback(
          sessionId,
          `dir=${shellQuote(path)}; for item in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do [ -e "$item" ] || continue; name=$(basename "$item"); target="$item"; ${PORTABLE_STAT_FIELDS_COMMAND}; printf "%s\\t%s\\t%s\\t%s\\n" "$name" "$type" "\${size:-0}" "\${mtime:-0}"; done`,
        );

        const entries: DirEntry[] = output
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [name = "", typeName = "other", size = "0", mtime = "0"] = line.split("\t");
            return {
              name,
              type: typeName as DirEntry["type"],
              size: Number(size),
              mtime: new Date(Number(mtime) * 1000),
            };
          });

        if (page !== undefined) {
          const startIndex = page * limit;
          const endIndex = startIndex + limit;
          return createDirListResult(
            entries.slice(startIndex, endIndex),
            endIndex < entries.length ? String(page + 1) : undefined,
          );
        }

        return { entries };
      }

      const sftp = getSftpOrThrow(session);
      const fileList = await sftpReaddir(sftp, path);

      const entries: DirEntry[] = fileList.map((item: FileEntry) => {
        let type: DirEntry["type"] = "other";
        const attrs = item.attrs;
        const mode = attrs.mode ?? 0;

        if ((mode & 0o170000) === 0o100000) {
          type = "file";
        } else if ((mode & 0o170000) === 0o040000) {
          type = "directory";
        } else if ((mode & 0o170000) === 0o120000) {
          type = "symlink";
        }

        return {
          name: item.filename,
          type,
          size: attrs.size,
          mtime: new Date(typeof attrs.mtime === "number" ? attrs.mtime * 1000 : Date.now()),
          mode: attrs.mode,
        };
      });

      if (page !== undefined) {
        const startIndex = page * limit;
        const endIndex = startIndex + limit;
        const paginatedEntries = entries.slice(startIndex, endIndex);
        const hasMore = endIndex < entries.length;

        logger.debug("Directory listed with pagination", {
          sessionId,
          path,
          total: entries.length,
          page,
          returned: paginatedEntries.length,
          hasMore,
        });

        return createDirListResult(paginatedEntries, hasMore ? String(page + 1) : undefined);
      }

      logger.debug("Directory listed", {
        sessionId,
        path,
        count: entries.length,
      });
      return { entries };
    } catch (error) {
      logger.error("Failed to list directory", { sessionId, path, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to list directory ${path}. Check if the directory exists and is readable.`,
      );
    }
  }

  async function makeDirectories(sessionId: string, path: string): Promise<boolean> {
    logger.debug("Creating directories", { sessionId, path });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      const decision = policy.assertAllowed({
        action: "fs.mkdir",
        path,
        mode: session.info.policyMode,
      });
      if (decision.mode === "explain") {
        return true;
      }

      if (!hasSftp(session)) {
        await execFallback(sessionId, `mkdir -p ${shellQuote(path)}`);
        logger.debug("Directories created successfully via SSH fallback", {
          sessionId,
          path,
        });
        return true;
      }

      const sftp = getSftpOrThrow(session);
      await sftpMkdirRecursive(sftp, path);
      logger.debug("Directories created successfully", { sessionId, path });
      return true;
    } catch (error) {
      logger.error("Failed to create directories", { sessionId, path, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to create directories ${path}. Check parent directory permissions.`,
      );
    }
  }

  async function removeRecursive(sessionId: string, path: string): Promise<boolean> {
    logger.debug("Removing path recursively", { sessionId, path });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      const decision = policy.assertAllowed({
        action: "fs.remove",
        path,
        mode: session.info.policyMode,
        destructive: true,
      });
      if (decision.mode === "explain") {
        return true;
      }

      if (!hasSftp(session)) {
        await execFallback(sessionId, `rm -rf ${shellQuote(path)}`);
        logger.debug("Path removed successfully via SSH fallback", {
          sessionId,
          path,
        });
        return true;
      }

      const sftp = getSftpOrThrow(session);
      const stats = await sftpStat(sftp, path);
      const mode = stats.mode ?? 0;
      const isDirectory = (mode & 0o170000) === 0o040000;

      if (isDirectory) {
        await sftpRmdirRecursive(sftp, path);
      } else {
        await sftpUnlink(sftp, path);
      }

      logger.debug("Path removed successfully", { sessionId, path });
      metrics.recordFileDelete();
      return true;
    } catch (error) {
      logger.error("Failed to remove path", { sessionId, path, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to remove ${path}. Check if the path exists and you have write permissions.`,
      );
    }
  }

  async function renameFile(sessionId: string, from: string, to: string): Promise<boolean> {
    logger.debug("Renaming file", { sessionId, from, to });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    try {
      const decision = policy.assertAllowed({
        action: "fs.rename",
        path: from,
        secondaryPath: to,
        mode: session.info.policyMode,
      });
      if (decision.mode === "explain") {
        return true;
      }

      if (!hasSftp(session)) {
        await execFallback(sessionId, `mv ${shellQuote(from)} ${shellQuote(to)}`);
        logger.debug("File renamed successfully via SSH fallback", {
          sessionId,
          from,
          to,
        });
        return true;
      }

      const sftp = getSftpOrThrow(session);
      await sftpRename(sftp, from, to);
      logger.debug("File renamed successfully", { sessionId, from, to });
      return true;
    } catch (error) {
      logger.error("Failed to rename file", { sessionId, from, to, error });
      throw wrapError(
        error,
        ErrorCode.EFS,
        `Failed to rename ${from} to ${to}. Check if the source exists and destination is writable.`,
      );
    }
  }

  async function pathExists(sessionId: string, path: string): Promise<boolean> {
    try {
      await statFile(sessionId, path);
      return true;
    } catch {
      return false;
    }
  }

  async function getFileSize(sessionId: string, path: string): Promise<number> {
    const stats = await statFile(sessionId, path);
    return stats.size;
  }

  async function getFileSizeInternal(sessionId: string, path: string): Promise<number> {
    const stats = await statFileInternal(sessionId, path);
    return stats.size;
  }

  async function isDirectory(sessionId: string, path: string): Promise<boolean> {
    try {
      const stats = await statFile(sessionId, path);
      return stats.type === "directory";
    } catch {
      return false;
    }
  }

  async function isFile(sessionId: string, path: string): Promise<boolean> {
    try {
      const stats = await statFile(sessionId, path);
      return stats.type === "file";
    } catch {
      return false;
    }
  }

  return {
    readFile,
    writeFile,
    statFile,
    listDirectory,
    makeDirectories,
    removeRecursive,
    renameFile,
    pathExists,
    getFileSize,
    isDirectory,
    isFile,
  };
}
