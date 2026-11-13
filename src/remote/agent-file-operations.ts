import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { isPathAllowed } from "./policy.js";
import type { AgentPolicy } from "./types.js";

type FileMutation = "mkdir" | "copy" | "move" | "remove";

function denied(message: string): Error {
  return Object.assign(new Error(message), { code: "POLICY_DENIED" as const });
}

function requiredPath(policy: AgentPolicy, value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0") || !path.isAbsolute(value)) {
    throw denied("Provide an absolute local file path");
  }
  if (!isPathAllowed(policy, value)) {
    throw denied("Path is not allowed by local policy");
  }
  return value;
}

async function canonicalExisting(policy: AgentPolicy, value: unknown): Promise<string> {
  const requested = requiredPath(policy, value);
  try {
    const resolved = await realpath(requested);
    if (!isPathAllowed(policy, resolved)) {
      throw denied("Path resolves outside the allowed directories");
    }
    return resolved;
  } catch (error) {
    if ((error as { code?: string }).code === "POLICY_DENIED") throw error;
    throw denied("Cannot access this path with the current device permissions");
  }
}

async function canonicalTarget(policy: AgentPolicy, value: unknown): Promise<string> {
  const requested = requiredPath(policy, value);
  const leaf = path.basename(requested);
  if (leaf === "." || leaf === ".." || !leaf || requested === path.parse(requested).root) {
    throw denied("Provide a non-root destination path");
  }

  let ancestor = path.dirname(requested);
  for (;;) {
    try {
      const canonicalParent = await realpath(ancestor);
      const missingParents = path.relative(ancestor, path.dirname(requested));
      const destination = path.resolve(canonicalParent, missingParents, leaf);
      if (!isPathAllowed(policy, destination)) {
        throw denied("Destination resolves outside the allowed directories");
      }
      return destination;
    } catch (error) {
      if ((error as { code?: string }).code === "POLICY_DENIED") throw error;
      if ((error as { code?: string }).code !== "ENOENT") {
        throw denied("Destination parent cannot be accessed");
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw denied("Cannot resolve destination parent");
      ancestor = parent;
    }
  }
}

async function assertSafeDestination(policy: AgentPolicy, value: unknown): Promise<string> {
  const destination = await canonicalTarget(policy, value);
  try {
    // Reject symlink destinations even when overwriting, since copy/rename semantics differ
    // by platform and a link may otherwise redirect a write outside the selected folder.
    const kind = await lstat(destination);
    if (kind.isSymbolicLink()) throw denied("Destination must not be a symbolic link");
    await canonicalExisting(policy, destination);
  } catch (error) {
    if ((error as { code?: string }).code === "POLICY_DENIED") throw error;
    if ((error as { code?: string }).code !== "ENOENT") {
      throw denied("Destination cannot be inspected");
    }
  }
  return destination;
}

function fileType(stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): string {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

export async function inspectComputerFile(
  policy: AgentPolicy,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const operation = args.operation;
  if (operation !== "list" && operation !== "stat") {
    throw denied("Choose a file inspection operation: list or stat");
  }
  const target = await canonicalExisting(policy, args.path);
  if (operation === "stat") {
    const info = await stat(target);
    return {
      operation: "stat",
      path: target,
      type: fileType(info),
      size_bytes: info.size,
      modified_at: info.mtime.toISOString(),
    };
  }

  const max = args.max_entries === undefined ? 50 : args.max_entries;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 100) {
    throw denied("max_entries must be between 1 and 100");
  }
  const entries: { name: string; type: string }[] = [];
  let truncated = false;
  const directory = await opendir(target);
  try {
    for await (const entry of directory) {
      if (entries.length === max) {
        truncated = true;
        break;
      }
      entries.push({ name: entry.name, type: fileType(entry) });
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return { operation: "list", path: target, entries, truncated };
}

function parseFileMutation(args: Record<string, unknown>): {
  operation: FileMutation;
  recursive: boolean;
  overwrite: boolean;
} {
  const operation = args.operation as FileMutation;
  if (!["mkdir", "copy", "move", "remove"].includes(operation)) {
    throw denied("Choose a file operation: mkdir, copy, move or remove");
  }
  const recursive = args.recursive === undefined ? false : args.recursive;
  const overwrite = args.overwrite === undefined ? false : args.overwrite;
  if (typeof recursive !== "boolean" || typeof overwrite !== "boolean") {
    throw denied("recursive and overwrite must be boolean");
  }
  return { operation, recursive, overwrite };
}

async function createComputerDirectory(
  policy: AgentPolicy,
  value: unknown,
  recursive: boolean,
): Promise<Record<string, unknown>> {
  const target = await canonicalTarget(policy, value);
  await mkdir(target, { recursive });
  return { operation: "mkdir", path: target, success: true };
}

async function canonicalMutationSource(
  policy: AgentPolicy,
  value: unknown,
): Promise<{ path: string; isDirectory: boolean; isFile: boolean }> {
  const requestedSource = requiredPath(policy, value);
  // Check the *requested* leaf before realpath: otherwise removing a symlink
  // would silently remove its target rather than the selected link.
  const requestedInfo = await lstat(requestedSource);
  if (requestedInfo.isSymbolicLink()) {
    throw denied("Use an explicit shell command to manage symbolic links");
  }
  const source = await canonicalExisting(policy, requestedSource);
  if (source === path.parse(source).root) {
    throw denied("Cannot modify a filesystem root");
  }
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink()) {
    throw denied("Use an explicit shell command to manage symbolic links");
  }
  return { path: source, isDirectory: sourceInfo.isDirectory(), isFile: sourceInfo.isFile() };
}

async function removeComputerEntry(
  policy: AgentPolicy,
  requested: unknown,
  recursive: boolean,
): Promise<Record<string, unknown>> {
  const source = await canonicalMutationSource(policy, requested);
  if (source.isDirectory) {
    if (recursive) await rm(source.path, { recursive: true, force: false });
    else await rmdir(source.path);
  } else {
    await unlink(source.path);
  }
  return { operation: "remove", path: source.path, success: true };
}

async function transferComputerEntry(
  policy: AgentPolicy,
  args: Record<string, unknown>,
  operation: "copy" | "move",
  overwrite: boolean,
): Promise<Record<string, unknown>> {
  const source = await canonicalMutationSource(policy, args.path);
  const destination = await assertSafeDestination(policy, args.destination_path);
  if (source.path === destination) {
    throw denied("Source and destination cannot be the same");
  }
  if (!overwrite) {
    try {
      await lstat(destination);
      throw denied("Destination exists; set overwrite to true to replace it");
    } catch (error) {
      if ((error as { code?: string }).code === "POLICY_DENIED") throw error;
      if ((error as { code?: string }).code !== "ENOENT") {
        throw denied("Destination cannot be inspected");
      }
    }
  }
  if (operation === "copy") {
    if (!source.isFile) throw denied("Copy currently supports regular files only");
    await copyFile(source.path, destination, overwrite ? 0 : constants.COPYFILE_EXCL);
  } else {
    await rename(source.path, destination);
  }
  return { operation, path: source.path, destination_path: destination, success: true };
}

export async function manageComputerFile(
  policy: AgentPolicy,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { operation, recursive, overwrite } = parseFileMutation(args);
  if (operation === "mkdir") return createComputerDirectory(policy, args.path, recursive);
  if (operation === "remove") return removeComputerEntry(policy, args.path, recursive);
  return transferComputerEntry(policy, args, operation, overwrite);
}
