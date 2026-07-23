import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { isPathAllowed } from "./policy.js";
import type { AgentPolicy, RemoteErrorCode } from "./types.js";

interface AuthorizedFile {
  file: FileHandle;
  parent?: FileHandle;
}

const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const DIRECTORY_ONLY = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
const OWNER_READ_WRITE = constants.S_IRUSR | constants.S_IWUSR;

function codedError(message: string, code: RemoteErrorCode): Error {
  return Object.assign(new Error(message), { code });
}

function policyDenied(message: string): Error {
  return codedError(message, "POLICY_DENIED");
}

function operationFailed(message: string): Error {
  return codedError(message, "INTERNAL_ERROR");
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function sameFileIdentity(
  opened: Awaited<ReturnType<FileHandle["stat"]>>,
  resolved: Awaited<ReturnType<typeof stat>>,
): boolean {
  return opened.dev === resolved.dev && opened.ino === resolved.ino;
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (!handle) {
    return;
  }
  try {
    await handle.close();
  } catch {
    // The operation result is already known; closing must not expose host details.
  }
}

function assertRequestedPath(policy: AgentPolicy, requestedPath: string, message: string): void {
  if (!requestedPath || !isPathAllowed(policy, requestedPath)) {
    throw policyDenied(message);
  }
}

async function openedCanonicalPath(handle: FileHandle, expectedPath: string): Promise<string> {
  if (process.platform === "linux") {
    return realpath(`/proc/self/fd/${handle.fd}`);
  }
  return realpath(expectedPath);
}

async function verifyOpenedHandle(
  policy: AgentPolicy,
  handle: FileHandle,
  expectedPath: string,
  expectedType: "file" | "directory",
  message: string,
): Promise<string> {
  try {
    const openedPath = await openedCanonicalPath(handle, expectedPath);
    if (!isPathAllowed(policy, openedPath)) {
      throw policyDenied(message);
    }
    const [openedStats, resolvedStats] = await Promise.all([handle.stat(), stat(openedPath)]);
    const typeMatches = expectedType === "file" ? openedStats.isFile() : openedStats.isDirectory();
    if (!typeMatches || !sameFileIdentity(openedStats, resolvedStats)) {
      throw policyDenied(message);
    }
    return openedPath;
  } catch (error) {
    if (errorCode(error) === "POLICY_DENIED") {
      throw error;
    }
    throw policyDenied(message);
  }
}

async function canonicalizeExisting(
  policy: AgentPolicy,
  requestedPath: string,
  message: string,
): Promise<string> {
  assertRequestedPath(policy, requestedPath, message);
  try {
    const canonicalPath = await realpath(requestedPath);
    if (!isPathAllowed(policy, canonicalPath)) {
      throw policyDenied(message);
    }
    return canonicalPath;
  } catch (error) {
    if (errorCode(error) === "POLICY_DENIED") {
      throw error;
    }
    throw policyDenied(message);
  }
}

async function openExistingFile(
  policy: AgentPolicy,
  requestedPath: string,
  flags: number,
  message: string,
): Promise<AuthorizedFile> {
  const canonicalPath = await canonicalizeExisting(policy, requestedPath, message);
  let file: FileHandle | undefined;
  try {
    file = await open(canonicalPath, flags | NO_FOLLOW);
    await verifyOpenedHandle(policy, file, canonicalPath, "file", message);
    return { file };
  } catch (error) {
    await closeQuietly(file);
    if (errorCode(error) === "POLICY_DENIED") {
      throw error;
    }
    throw policyDenied(message);
  }
}

async function openCanonicalParent(
  policy: AgentPolicy,
  requestedPath: string,
  message: string,
): Promise<{ canonicalParent: string; leaf: string }> {
  if (/[\\/]$/u.test(requestedPath)) {
    throw policyDenied(message);
  }
  const requestedParent = path.dirname(requestedPath);
  const leaf = path.basename(requestedPath);
  if (!leaf || leaf === "." || leaf === "..") {
    throw policyDenied(message);
  }
  assertRequestedPath(policy, requestedParent, message);
  try {
    const canonicalParent = await realpath(requestedParent);
    if (!isPathAllowed(policy, canonicalParent)) {
      throw policyDenied(message);
    }
    return { canonicalParent, leaf };
  } catch (error) {
    if (errorCode(error) === "POLICY_DENIED") {
      throw error;
    }
    throw policyDenied(message);
  }
}

async function createNewFile(
  policy: AgentPolicy,
  requestedPath: string,
  message: string,
): Promise<AuthorizedFile> {
  const { canonicalParent, leaf } = await openCanonicalParent(policy, requestedPath, message);
  let parent: FileHandle | undefined;
  let file: FileHandle | undefined;
  try {
    if (process.platform === "linux") {
      parent = await open(canonicalParent, constants.O_RDONLY | DIRECTORY_ONLY | NO_FOLLOW);
      await verifyOpenedHandle(policy, parent, canonicalParent, "directory", message);
      const anchoredPath = `/proc/self/fd/${parent.fd}/${leaf}`;
      file = await open(
        anchoredPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
        OWNER_READ_WRITE,
      );
      await verifyOpenedHandle(policy, file, path.join(canonicalParent, leaf), "file", message);
      return { file, parent };
    }

    const canonicalCandidate = path.join(canonicalParent, leaf);
    if (!isPathAllowed(policy, canonicalCandidate)) {
      throw policyDenied(message);
    }
    file = await open(
      canonicalCandidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      OWNER_READ_WRITE,
    );
    await verifyOpenedHandle(policy, file, canonicalCandidate, "file", message);
    return { file };
  } catch (error) {
    await closeQuietly(file);
    await closeQuietly(parent);
    if (errorCode(error) === "POLICY_DENIED") {
      throw error;
    }
    throw policyDenied(message);
  }
}

async function openWritableFile(
  policy: AgentPolicy,
  requestedPath: string,
  message: string,
): Promise<AuthorizedFile> {
  assertRequestedPath(policy, requestedPath, message);
  try {
    await realpath(requestedPath);
    return openExistingFile(policy, requestedPath, constants.O_WRONLY, message);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      if (errorCode(error) === "POLICY_DENIED") {
        throw error;
      }
      throw policyDenied(message);
    }
    return createNewFile(policy, requestedPath, message);
  }
}

export async function withAuthorizedRead<T>(
  policy: AgentPolicy,
  requestedPath: string,
  denialMessage: string,
  operationMessage: string,
  operation: (file: FileHandle) => Promise<T>,
): Promise<T> {
  const authorized = await openExistingFile(
    policy,
    requestedPath,
    constants.O_RDONLY,
    denialMessage,
  );
  try {
    return await operation(authorized.file);
  } catch {
    throw operationFailed(operationMessage);
  } finally {
    await closeQuietly(authorized.file);
  }
}

export async function withAuthorizedWrite<T>(
  policy: AgentPolicy,
  requestedPath: string,
  denialMessage: string,
  operationMessage: string,
  operation: (file: FileHandle) => Promise<T>,
): Promise<T> {
  const authorized = await openWritableFile(policy, requestedPath, denialMessage);
  try {
    return await operation(authorized.file);
  } catch {
    throw operationFailed(operationMessage);
  } finally {
    await closeQuietly(authorized.file);
    await closeQuietly(authorized.parent);
  }
}
