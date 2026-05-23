import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import type { SFTPWrapper, Stats } from "ssh2";
import { createFilesystemError } from "./errors.js";
import { logger } from "./logging.js";
import type { MetricsCollector } from "./metrics.js";
import type { ServerConfig } from "./config.js";
import type { PolicyAction, PolicyEngine } from "./policy.js";
import type { SessionManager } from "./session.js";
import { SSHMCPError, type PolicyMode } from "./types.js";

export interface TransferProgress {
  filename: string;
  transferred: number;
  total: number;
  percentage: number;
  bytesPerSecond: number;
  eta: number;
}

export interface TransferOptions {
  sessionId: string;
  onProgress?: (progress: TransferProgress) => void;
}

export interface TransferResult {
  success: boolean;
  filename: string;
  size: number;
  durationMs: number;
  averageSpeed: number;
  sha256: string;
  verified: boolean;
}

export interface TransferService {
  uploadFileWithProgress(
    localPath: string,
    remotePath: string,
    options: TransferOptions,
  ): Promise<TransferResult>;
  downloadFileWithProgress(
    remotePath: string,
    localPath: string,
    options: TransferOptions,
  ): Promise<TransferResult>;
}

export interface TransferServiceDeps {
  sessionManager: Pick<SessionManager, "getSession">;
  metrics: Pick<MetricsCollector, "recordTransfer">;
  policy: Pick<PolicyEngine, "assertAllowed">;
  config: Pick<ServerConfig, "maxTransferBytes">;
}

interface LocalWritePath {
  absolutePath: string;
  canonicalPath: string;
  parentCanonicalPath: string;
  action: Extract<PolicyAction, "transfer.local.create" | "transfer.local.overwrite">;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function validateLocalPathInput(localPath: string): void {
  if (localPath.trim().length === 0) {
    throw createFilesystemError("Local path must not be empty");
  }
  if (localPath.includes("\0")) {
    throw createFilesystemError("Local path contains NUL byte");
  }
}

function resolveAbsoluteLocalPath(localPath: string): string {
  validateLocalPathInput(localPath);
  return path.resolve(localPath);
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function resolveLocalReadPath(localPath: string): Promise<string> {
  const absolutePath = resolveAbsoluteLocalPath(localPath);
  try {
    return await fs.promises.realpath(absolutePath);
  } catch (error) {
    throw createFilesystemError(
      `Local path ${localPath} could not be resolved for reading`,
      error instanceof Error ? error.message : undefined,
    );
  }
}

async function resolveLocalWritePath(localPath: string): Promise<LocalWritePath> {
  const absolutePath = resolveAbsoluteLocalPath(localPath);
  const parentPath = path.dirname(absolutePath);
  let parentCanonicalPath: string;

  try {
    parentCanonicalPath = await fs.promises.realpath(parentPath);
  } catch (error) {
    throw createFilesystemError(
      `Local parent directory ${parentPath} could not be resolved for writing`,
      error instanceof Error ? error.message : undefined,
    );
  }

  try {
    const targetCanonicalPath = await fs.promises.realpath(absolutePath);
    return {
      absolutePath,
      canonicalPath: targetCanonicalPath,
      parentCanonicalPath,
      action: "transfer.local.overwrite",
    };
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw createFilesystemError(
        `Local path ${localPath} could not be resolved for writing`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  return {
    absolutePath,
    canonicalPath: path.join(parentCanonicalPath, path.basename(absolutePath)),
    parentCanonicalPath,
    action: "transfer.local.create",
  };
}

async function authorizeLocalReadPath(
  localPath: string,
  mode: PolicyMode,
  policy: Pick<PolicyEngine, "assertAllowed">,
): Promise<string> {
  const canonicalPath = await resolveLocalReadPath(localPath);
  policy.assertAllowed({
    action: "transfer.local.read",
    path: canonicalPath,
    mode,
  });
  return canonicalPath;
}

async function authorizeLocalWritePath(
  localPath: string,
  mode: PolicyMode,
  policy: Pick<PolicyEngine, "assertAllowed">,
): Promise<LocalWritePath> {
  const resolved = await resolveLocalWritePath(localPath);
  policy.assertAllowed({
    action: resolved.action,
    path: resolved.canonicalPath,
    secondaryPath: resolved.parentCanonicalPath,
    mode,
  });
  return resolved;
}

function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, data, {}, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (err: Error | null | undefined, data: Buffer) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err: Error | null | undefined, stats: Stats) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stats);
    });
  });
}

export function createTransferService({
  sessionManager,
  metrics,
  policy,
  config,
}: TransferServiceDeps): TransferService {
  async function uploadFileWithProgress(
    localPath: string,
    remotePath: string,
    options: TransferOptions,
  ): Promise<TransferResult> {
    const { sessionId, onProgress } = options;

    logger.debug("Starting file upload with progress", {
      sessionId,
      localPath,
      remotePath,
    });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw createFilesystemError("Session not found or expired");
    }
    if (!session.sftp) {
      throw createFilesystemError("SFTP subsystem is unavailable for this session");
    }

    const decision = policy.assertAllowed({
      action: "transfer.upload",
      path: remotePath,
      mode: session.info.policyMode,
    });
    if (decision.mode === "explain") {
      return {
        success: true,
        filename: path.basename(localPath),
        size: 0,
        durationMs: 0,
        averageSpeed: 0,
        sha256: "",
        verified: false,
      };
    }

    const canonicalLocalPath = await authorizeLocalReadPath(
      localPath,
      session.info.policyMode,
      policy,
    );
    const startTime = Date.now();
    const filename = path.basename(canonicalLocalPath);

    try {
      const stats = await fs.promises.stat(canonicalLocalPath);
      const totalSize = stats.size;
      if (totalSize > config.maxTransferBytes) {
        throw createFilesystemError(
          `Transfer exceeds maxTransferBytes (${config.maxTransferBytes})`,
          "Use a smaller file or raise SSH_MCP_MAX_TRANSFER_BYTES intentionally.",
        );
      }
      const fileContent = await fs.promises.readFile(canonicalLocalPath);
      const localSha256 = sha256(fileContent);

      await sftpWriteFile(session.sftp, remotePath, fileContent);
      const remoteContent = await sftpReadFile(session.sftp, remotePath);
      const remoteSha256 = sha256(remoteContent);
      const verified = localSha256 === remoteSha256;
      if (!verified) {
        throw createFilesystemError(
          `Transfer verification failed for ${remotePath}`,
          "Remote SHA-256 does not match the local file after upload",
        );
      }

      if (onProgress) {
        const elapsed = (Date.now() - startTime) / 1000 || 1;
        onProgress({
          filename,
          transferred: totalSize,
          total: totalSize,
          percentage: 100,
          bytesPerSecond: totalSize / elapsed,
          eta: 0,
        });
      }

      const durationMs = Date.now() - startTime;
      const averageSpeed = totalSize / ((durationMs || 1) / 1000);

      logger.info("File upload completed", {
        sessionId,
        filename,
        size: totalSize,
        durationMs,
        averageSpeed,
        sha256: localSha256,
      });
      metrics.recordTransfer("upload", totalSize);

      return {
        success: true,
        filename,
        size: totalSize,
        durationMs,
        averageSpeed,
        sha256: localSha256,
        verified,
      };
    } catch (error) {
      if (error instanceof SSHMCPError) {
        throw error;
      }
      logger.error("File upload failed", { sessionId, localPath, error });
      throw createFilesystemError(`Failed to upload ${localPath}: ${error}`);
    }
  }

  async function downloadFileWithProgress(
    remotePath: string,
    localPath: string,
    options: TransferOptions,
  ): Promise<TransferResult> {
    const { sessionId, onProgress } = options;

    logger.debug("Starting file download with progress", {
      sessionId,
      remotePath,
      localPath,
    });

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw createFilesystemError("Session not found or expired");
    }
    if (!session.sftp) {
      throw createFilesystemError("SFTP subsystem is unavailable for this session");
    }

    const decision = policy.assertAllowed({
      action: "transfer.download",
      path: remotePath,
      mode: session.info.policyMode,
    });
    if (decision.mode === "explain") {
      return {
        success: true,
        filename: path.basename(remotePath),
        size: 0,
        durationMs: 0,
        averageSpeed: 0,
        sha256: "",
        verified: false,
      };
    }

    const startTime = Date.now();
    const filename = path.basename(remotePath);

    try {
      const targetPath = await authorizeLocalWritePath(localPath, session.info.policyMode, policy);
      const stats = await sftpStat(session.sftp, remotePath);
      const totalSize = stats.size ?? 0;
      if (totalSize > config.maxTransferBytes) {
        throw createFilesystemError(
          `Transfer exceeds maxTransferBytes (${config.maxTransferBytes})`,
          "Use a smaller file or raise SSH_MCP_MAX_TRANSFER_BYTES intentionally.",
        );
      }
      const data = await sftpReadFile(session.sftp, remotePath);
      const remoteSha256 = sha256(data);
      const tempLocalPath = `${targetPath.absolutePath}.tmp.${Date.now()}`;
      const tempPath = await authorizeLocalWritePath(
        tempLocalPath,
        session.info.policyMode,
        policy,
      );
      await fs.promises.writeFile(tempPath.absolutePath, data, { flag: "wx" });
      const tempReadPath = await authorizeLocalReadPath(
        tempPath.absolutePath,
        session.info.policyMode,
        policy,
      );
      const localData = await fs.promises.readFile(tempReadPath);
      const localSha256 = sha256(localData);
      const verified = remoteSha256 === localSha256;
      if (!verified) {
        await fs.promises.rm(tempPath.absolutePath, { force: true });
        throw createFilesystemError(
          `Transfer verification failed for ${remotePath}`,
          "Local SHA-256 does not match the remote file after download",
        );
      }
      const finalTargetPath = await authorizeLocalWritePath(
        localPath,
        session.info.policyMode,
        policy,
      );
      await fs.promises.rename(tempPath.absolutePath, finalTargetPath.absolutePath);

      if (onProgress) {
        const elapsed = (Date.now() - startTime) / 1000 || 1;
        onProgress({
          filename,
          transferred: totalSize,
          total: totalSize,
          percentage: 100,
          bytesPerSecond: totalSize / elapsed,
          eta: 0,
        });
      }

      const durationMs = Date.now() - startTime;
      const averageSpeed = totalSize / ((durationMs || 1) / 1000);

      logger.info("File download completed", {
        sessionId,
        filename,
        size: totalSize,
        durationMs,
        averageSpeed,
        sha256: remoteSha256,
      });
      metrics.recordTransfer("download", totalSize);

      return {
        success: true,
        filename,
        size: totalSize,
        durationMs,
        averageSpeed,
        sha256: remoteSha256,
        verified,
      };
    } catch (error) {
      if (error instanceof SSHMCPError) {
        throw error;
      }
      logger.error("File download failed", { sessionId, remotePath, error });
      throw createFilesystemError(`Failed to download ${remotePath}: ${error}`);
    }
  }

  return {
    uploadFileWithProgress,
    downloadFileWithProgress,
  };
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
  }
  return `${bytesPerSecond.toFixed(0)} B/s`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

export function formatETA(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
