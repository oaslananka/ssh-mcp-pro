import type { SFTPWrapper, Stats, FileEntry } from "ssh2";
import { createFilesystemError } from "./errors.js";

/**
 * Check whether a session has an active SFTP subsystem.
 */
export function hasSftp(session: { sftp?: unknown } | undefined): boolean {
  return !!session?.sftp;
}

/**
 * Get the SFTP wrapper from a session or throw if unavailable.
 */
export function getSftpOrThrow(session: { sftp?: SFTPWrapper }): SFTPWrapper {
  if (!session.sftp) {
    throw createFilesystemError("SFTP subsystem is unavailable for this session");
  }

  return session.sftp;
}

/**
 * Read a file via SFTP.
 */
export function sftpReadFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
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

/**
 * Write a file via SFTP.
 */
export function sftpWriteFile(sftp: SFTPWrapper, path: string, data: Buffer): Promise<void> {
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

/**
 * Stat a path via SFTP.
 */
export function sftpStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
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

/**
 * Read directory entries via SFTP.
 */
export function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<FileEntry[]> {
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

/**
 * Create a directory via SFTP.
 */
export function sftpMkdir(sftp: SFTPWrapper, path: string): Promise<void> {
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

/**
 * Remove a directory via SFTP.
 */
export function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
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

/**
 * Delete a file via SFTP.
 */
export function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
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

/**
 * Rename a file via SFTP.
 */
export function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
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

/**
 * Change file mode via SFTP.
 */
export function sftpChmod(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
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

/**
 * Recursively create directories via SFTP.
 */
export async function sftpMkdirRecursive(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  const parts = dirPath.split("/").filter(Boolean);
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

/**
 * Recursively remove a directory and its contents via SFTP.
 */
export async function sftpRmdirRecursive(sftp: SFTPWrapper, dirPath: string): Promise<void> {
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
