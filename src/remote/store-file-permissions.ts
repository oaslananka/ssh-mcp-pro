import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

function restrictFile(filePath: string, create: boolean): void {
  const flags =
    constants.O_RDWR |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK |
    (create ? constants.O_CREAT : 0);
  let fd: number;
  try {
    fd = openSync(filePath, flags, 0o600);
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Remote store requires regular files");
    if ((stat.mode & 0o7777) !== 0o600) fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
}

/** Protect storage before SQLite reads existing data or creates its journals. */
export function prepareRemoteStoreFile(filePath: string): void {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true, mode: 0o700 });
  // Windows access is controlled by the deployment's ACLs, not POSIX mode bits.
  if (process.platform === "win32") return;

  restrictFile(filePath, true);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    restrictFile(filePath + suffix, false);
  }
}
