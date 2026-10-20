import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Find a known executable without spawning "which" or a PATH-selected shell.
 * Ignore empty, relative, and world-writable PATH directories on POSIX.
 * This does not protect against a malicious PATH set by the calling process.
 */
export function resolveExecutableOnPath(name, path = process.env.PATH ?? "") {
  if (name !== "gh" && name !== "ssh-mcp-pro") {
    throw new Error("Unsupported executable name");
  }

  const candidates = process.platform === "win32" ? [name + ".exe", name] : [name];
  for (const directory of path.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    try {
      const canonicalDir = realpathSync(directory);
      const mode = statSync(canonicalDir);
      if (!mode.isDirectory()) continue;
      if (process.platform !== "win32" && (mode.mode & 0o002) !== 0) continue;

      const executable = findExecutableInDirectory(canonicalDir, candidates);
      if (executable) return executable;
    } catch {
      // Missing or unsuitable PATH entry; do not execute anything from it.
    }
  }
  return null;
}

function findExecutableInDirectory(directory, candidates) {
  for (const candidate of candidates) {
    try {
      const result = realpathSync(join(directory, candidate));
      if (!statSync(result).isFile()) continue;
      accessSync(result, constants.X_OK);
      return result;
    } catch {
      // Candidate missing or not executable; inspect the next candidate.
    }
  }
  return null;
}
