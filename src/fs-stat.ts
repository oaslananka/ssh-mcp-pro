import { getSftpOrThrow, hasSftp, sftpStat } from "./fs-sftp.js";
import { logger } from "./logging.js";
import type { SessionManager } from "./session.js";
import type { FileStatInfo } from "./types.js";

export const PORTABLE_STAT_FIELDS_COMMAND =
  'type=other; if [ -L "$target" ]; then type=symlink; elif [ -d "$target" ]; then type=directory; elif [ -f "$target" ]; then type=file; fi; size=$( (stat -c %s "$target" 2>/dev/null || stat -f %z "$target" 2>/dev/null || wc -c < "$target" 2>/dev/null) | tr -d " " | head -n 1); mtime=$( (stat -c %Y "$target" 2>/dev/null || stat -f %m "$target" 2>/dev/null || echo 0) | head -n 1); mode=$( (stat -c %a "$target" 2>/dev/null || stat -f %Lp "$target" 2>/dev/null || echo 0) | head -n 1)';
const PORTABLE_STAT_COMMAND = `${PORTABLE_STAT_FIELDS_COMMAND}; printf "%s\\t%s\\t%s\\t%s" "$type" "\${size:-0}" "\${mtime:-0}" "\${mode:-0}"`;

/** Resolve file metadata over SFTP, falling back to a portable remote shell stat. */
export function createStatFileInternal({
  sessionManager,
  execFallback,
  shellQuote,
}: {
  sessionManager: Pick<SessionManager, "getSession">;
  execFallback: (sessionId: string, command: string) => Promise<string>;
  shellQuote: (value: string) => string;
}) {
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
        mode: Number.parseInt(mode, 8),
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

  return statFileInternal;
}
