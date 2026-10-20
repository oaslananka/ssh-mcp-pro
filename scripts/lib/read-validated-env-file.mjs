import { closeSync, fstatSync, readFileSync, realpathSync } from "node:fs";

// The caller must first open a canonical path confined to its allowed root.
export function readValidatedEnvFile(descriptor, canonicalPath) {
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error("start:chatgpt: env file must be a regular file");
    }
    // Windows has no O_NOFOLLOW. Catch a replaced final symlink before
    // reading the opened descriptor; on POSIX the caller uses O_NOFOLLOW.
    if (process.platform === "win32" && realpathSync(canonicalPath) !== canonicalPath) {
      throw new Error("start:chatgpt: env file changed during validation");
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}
