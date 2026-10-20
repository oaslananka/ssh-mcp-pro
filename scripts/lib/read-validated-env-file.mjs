import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";

// The caller must first resolve the path to a canonical file inside its allowed root.
export function readValidatedEnvFile(canonicalPath) {
  // Hold one descriptor throughout the read. POSIX rejects a replaced final
  // symlink; Windows has no O_NOFOLLOW and needs a post-open path check.
  const descriptor = openSync(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error("start:chatgpt: env file must be a regular file");
    }
    if (constants.O_NOFOLLOW === undefined && realpathSync(canonicalPath) !== canonicalPath) {
      throw new Error("start:chatgpt: env file changed during validation");
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}
