import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { PolicyEngine, type PolicyConfig } from "../../src/policy.js";
import { createTransferService, formatETA, formatSize, formatSpeed } from "../../src/transfer.js";
import {
  createAllowPolicy,
  createSessionInfo,
  createTestConfig,
  createTransferMetrics,
} from "./helpers.js";

function createTransferPolicy(
  localPathAllowPrefixes: string[],
  overrides: Partial<PolicyConfig> = {},
) {
  return new PolicyEngine({
    mode: "enforce",
    allowRootLogin: false,
    allowRawSudo: false,
    allowDestructiveCommands: false,
    allowDestructiveFs: false,
    allowedHosts: [],
    commandAllow: [],
    commandDeny: [],
    pathAllowPrefixes: ["/tmp"],
    pathDenyPrefixes: [],
    localPathAllowPrefixes,
    localPathDenyPrefixes: [],
    tunnelAllowBindHosts: [],
    tunnelDenyBindHosts: [],
    tunnelAllowRemoteHosts: [],
    tunnelDenyRemoteHosts: [],
    tunnelAllowPorts: [],
    tunnelDenyPorts: [],
    ...overrides,
  });
}

function makeDirs(root: string) {
  const allowed = path.join(root, "allowed");
  const forbidden = path.join(root, "forbidden");
  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(forbidden, { recursive: true });
  return { allowed, forbidden };
}

describe("createTransferService", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("uploads files with progress", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const localPath = path.join(tempDir, "upload.txt");
    fs.writeFileSync(localPath, "hello world");
    const writeFile = jest.fn(
      (
        _remotePath: string,
        _data: Buffer,
        _options: object,
        callback: (err?: Error | null) => void,
      ) => callback(null),
    );
    const readFile = jest.fn(
      (_remotePath: string, callback: (err: Error | null, data: Buffer) => void) =>
        callback(null, Buffer.from("hello world")),
    );
    const onProgress = jest.fn();

    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: { readFile, writeFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });

    const result = await service.uploadFileWithProgress(localPath, "/tmp/upload.txt", {
      sessionId: "session-1",
      onProgress,
    });

    expect(result.success).toBe(true);
    expect(result.size).toBe(11);
    expect(result.verified).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        percentage: 100,
      }),
    );
  });

  test("rejects uploads and downloads over maxTransferBytes before buffering", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const localPath = path.join(tempDir, "large.bin");
    fs.writeFileSync(localPath, "hello world");
    const config = { ...createTestConfig(), maxTransferBytes: 5 };
    const writeFile = jest.fn(
      (
        _remotePath: string,
        _data: Buffer,
        _options: object,
        callback: (err?: Error | null) => void,
      ) => callback(null),
    );
    const readFile = jest.fn(
      (_remotePath: string, callback: (err: Error | null, data: Buffer) => void) =>
        callback(null, Buffer.from("hello world")),
    );

    const uploadService = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: { readFile, writeFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config,
    });

    await expect(
      uploadService.uploadFileWithProgress(localPath, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("maxTransferBytes");
    expect(writeFile).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();

    const downloadService = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: {
              stat: (
                _remotePath: string,
                callback: (err: Error | null, stats: { size: number }) => void,
              ) => callback(null, { size: 10 }),
              readFile,
            },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config,
    });

    await expect(
      downloadService.downloadFileWithProgress("/tmp/remote.txt", path.join(tempDir, "out.bin"), {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("maxTransferBytes");
    expect(readFile).not.toHaveBeenCalled();
  });

  test("checks local upload source policy before reading", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const { allowed, forbidden } = makeDirs(tempDir);
    const allowedPath = path.join(allowed, "upload.txt");
    const forbiddenPath = path.join(forbidden, "secret.txt");
    fs.writeFileSync(allowedPath, "allowed");
    fs.writeFileSync(forbiddenPath, "secret");
    const writeFile = jest.fn(
      (
        _remotePath: string,
        _data: Buffer,
        _options: object,
        callback: (err?: Error | null) => void,
      ) => callback(null),
    );
    const readFile = jest.fn(
      (_remotePath: string, callback: (err: Error | null, data: Buffer) => void) =>
        callback(null, Buffer.from("allowed")),
    );

    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: { readFile, writeFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createTransferPolicy([allowed]),
      config: createTestConfig(),
    });

    await expect(
      service.uploadFileWithProgress(allowedPath, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));

    writeFile.mockClear();
    readFile.mockClear();
    const localReadSpy = jest.spyOn(fs.promises, "readFile");
    try {
      await expect(
        service.uploadFileWithProgress(forbiddenPath, "/tmp/upload.txt", {
          sessionId: "session-1",
        }),
      ).rejects.toThrow("outside allowed prefixes");
      expect(localReadSpy).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
    } finally {
      localReadSpy.mockRestore();
    }
  });

  test("normalizes local upload paths and rejects NUL, prefix confusion, and symlink escapes", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const { allowed, forbidden } = makeDirs(tempDir);
    const allowedPath = path.join(allowed, "upload.txt");
    const prefixConfusionPath = path.join(tempDir, "allowed2", "upload.txt");
    const forbiddenPath = path.join(forbidden, "secret.txt");
    fs.mkdirSync(path.dirname(prefixConfusionPath), { recursive: true });
    fs.writeFileSync(allowedPath, "allowed");
    fs.writeFileSync(prefixConfusionPath, "confused");
    fs.writeFileSync(forbiddenPath, "secret");
    const writeFile = jest.fn(
      (
        _remotePath: string,
        _data: Buffer,
        _options: object,
        callback: (err?: Error | null) => void,
      ) => callback(null),
    );
    const readFile = jest.fn(
      (_remotePath: string, callback: (err: Error | null, data: Buffer) => void) =>
        callback(null, Buffer.from("allowed")),
    );
    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: { readFile, writeFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createTransferPolicy([allowed]),
      config: createTestConfig(),
    });

    const redundantPath = `${allowed}${path.sep}.${path.sep}${path.basename(allowedPath)}`;
    await expect(
      service.uploadFileWithProgress(redundantPath, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));

    await expect(
      service.uploadFileWithProgress(`${allowed}${path.sep}bad\0name`, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("NUL");

    await expect(
      service.uploadFileWithProgress(prefixConfusionPath, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("outside allowed prefixes");

    const symlinkPath = path.join(allowed, "link-to-secret");
    try {
      fs.symlinkSync(forbiddenPath, symlinkPath);
    } catch {
      return;
    }

    await expect(
      service.uploadFileWithProgress(symlinkPath, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("outside allowed prefixes");
  });

  test("downloads files with progress", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const localPath = path.join(tempDir, "download.txt");
    const onProgress = jest.fn();

    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: {
              stat: (
                _remotePath: string,
                callback: (err: Error | null, stats: { size: number }) => void,
              ) => callback(null, { size: 5 }),
              readFile: (
                _remotePath: string,
                callback: (err: Error | null, data: Buffer) => void,
              ) => callback(null, Buffer.from("hello")),
            },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });

    const result = await service.downloadFileWithProgress("/tmp/remote.txt", localPath, {
      sessionId: "session-1",
      onProgress,
    });

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(fs.readFileSync(localPath, "utf8")).toBe("hello");
    expect(onProgress).toHaveBeenCalled();
  });

  test("checks local download destination policy before writing", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const { allowed, forbidden } = makeDirs(tempDir);
    const allowedPath = path.join(allowed, "download.txt");
    const forbiddenPath = path.join(forbidden, "download.txt");
    const stat = jest.fn(
      (_remotePath: string, callback: (err: Error | null, stats: { size: number }) => void) =>
        callback(null, { size: 5 }),
    );
    const readFile = jest.fn(
      (_remotePath: string, callback: (err: Error | null, data: Buffer) => void) =>
        callback(null, Buffer.from("hello")),
    );
    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: { stat, readFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createTransferPolicy([allowed]),
      config: createTestConfig(),
    });

    await expect(
      service.downloadFileWithProgress("/tmp/remote.txt", allowedPath, {
        sessionId: "session-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(fs.readFileSync(allowedPath, "utf8")).toBe("hello");

    stat.mockClear();
    readFile.mockClear();
    const localWriteSpy = jest.spyOn(fs.promises, "writeFile");
    try {
      await expect(
        service.downloadFileWithProgress("/tmp/remote.txt", forbiddenPath, {
          sessionId: "session-1",
        }),
      ).rejects.toThrow("outside allowed prefixes");
      expect(localWriteSpy).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
    } finally {
      localWriteSpy.mockRestore();
    }
  });

  test("rejects local download traversal, prefix confusion, NUL, and symlink destination escapes", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const { allowed, forbidden } = makeDirs(tempDir);
    const prefixConfusionDir = path.join(tempDir, "allowed2");
    fs.mkdirSync(prefixConfusionDir, { recursive: true });
    const stat = jest.fn(
      (_remotePath: string, callback: (err: Error | null, stats: { size: number }) => void) =>
        callback(null, { size: 5 }),
    );
    const readFile = jest.fn(
      (_remotePath: string, callback: (err: Error | null, data: Buffer) => void) =>
        callback(null, Buffer.from("hello")),
    );
    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: { stat, readFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createTransferPolicy([allowed]),
      config: createTestConfig(),
    });

    await expect(
      service.downloadFileWithProgress(
        "/tmp/remote.txt",
        `${allowed}${path.sep}..${path.sep}forbidden${path.sep}escape.txt`,
        { sessionId: "session-1" },
      ),
    ).rejects.toThrow("outside allowed prefixes");

    await expect(
      service.downloadFileWithProgress("/tmp/remote.txt", path.join(prefixConfusionDir, "x.txt"), {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("outside allowed prefixes");

    await expect(
      service.downloadFileWithProgress("/tmp/remote.txt", `${allowed}${path.sep}bad\0name`, {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("NUL");

    const forbiddenTarget = path.join(forbidden, "target.txt");
    const symlinkPath = path.join(allowed, "link-to-target");
    fs.writeFileSync(forbiddenTarget, "secret");
    try {
      fs.symlinkSync(forbiddenTarget, symlinkPath);
    } catch {
      return;
    }

    await expect(
      service.downloadFileWithProgress("/tmp/remote.txt", symlinkPath, {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("outside allowed prefixes");
  });

  test("rejects missing SFTP sessions", async () => {
    const service = createTransferService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: {} }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });

    await expect(
      service.uploadFileWithProgress("a", "b", { sessionId: "session-1" }),
    ).rejects.toThrow("SFTP subsystem is unavailable");
  });

  test("rejects missing sessions", async () => {
    const service = createTransferService({
      sessionManager: {
        getSession: () => undefined,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });

    await expect(
      service.downloadFileWithProgress("remote", "local", { sessionId: "missing" }),
    ).rejects.toThrow("Session not found or expired");
  });

  test("returns dry-run transfer results in explain mode without local or SFTP IO", async () => {
    const readFile = jest.fn();
    const writeFile = jest.fn();
    const policy = {
      assertAllowed: jest.fn((context: { action: string }) => ({
        allowed: true,
        mode:
          context.action === "transfer.upload" || context.action === "transfer.download"
            ? "explain"
            : "enforce",
        action: context.action,
      })),
    };
    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo({ policyMode: "explain" }),
            sftp: { readFile, writeFile },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: policy as any,
      config: createTestConfig(),
    });

    await expect(
      service.uploadFileWithProgress("local.txt", "/tmp/remote.txt", {
        sessionId: "session-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        filename: "local.txt",
        size: 0,
        verified: false,
      }),
    );
    await expect(
      service.downloadFileWithProgress("/tmp/remote.txt", "local.txt", {
        sessionId: "session-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        filename: "remote.txt",
        size: 0,
        verified: false,
      }),
    );
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("rejects checksum mismatches and cleans temporary downloads", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const localPath = path.join(tempDir, "download.txt");
    const service = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: {
              stat: (
                _remotePath: string,
                callback: (err: Error | null, stats: { size?: number }) => void,
              ) => callback(null, {}),
              readFile: (
                _remotePath: string,
                callback: (err: Error | null, data: Buffer) => void,
              ) => callback(null, Buffer.from("remote")),
            },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });
    const readFileSpy = jest
      .spyOn(fs.promises, "readFile")
      .mockImplementation(async () => Buffer.from("local"));
    const rmSpy = jest.spyOn(fs.promises, "rm");

    try {
      await expect(
        service.downloadFileWithProgress("/tmp/remote.txt", localPath, {
          sessionId: "session-1",
        }),
      ).rejects.toThrow("verification failed");
      expect(rmSpy).toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
      rmSpy.mockRestore();
    }
  });

  test("formats transfer metrics", () => {
    expect(formatSpeed(2048)).toContain("KB/s");
    expect(formatSpeed(1024 * 1024)).toContain("MB/s");
    expect(formatSpeed(12)).toBe("12 B/s");
    expect(formatSize(1024 * 1024 * 1024)).toContain("GB");
    expect(formatSize(1024 * 1024)).toContain("MB");
    expect(formatSize(1024)).toContain("KB");
    expect(formatSize(5)).toBe("5 B");
    expect(formatETA(61)).toBe("1m 1s");
    expect(formatETA(5)).toBe("5s");
    expect(formatETA(3605)).toBe("1h 0m");
  });

  test("wraps SFTP callback failures for upload and download", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
    const localPath = path.join(tempDir, "upload.txt");
    fs.writeFileSync(localPath, "hello");

    const uploadService = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: {
              writeFile: (
                _remotePath: string,
                _data: Buffer,
                _options: object,
                callback: (err?: Error | null) => void,
              ) => callback(new Error("upload failed")),
            },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });

    await expect(
      uploadService.uploadFileWithProgress(localPath, "/tmp/upload.txt", {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("Failed to upload");

    const downloadService = createTransferService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            sftp: {
              stat: (
                _remotePath: string,
                callback: (err: Error | null, stats: { size: number }) => void,
              ) => callback(new Error("stat failed"), { size: 0 }),
              readFile: (
                _remotePath: string,
                callback: (err: Error | null, data: Buffer) => void,
              ) => callback(new Error("read failed"), Buffer.alloc(0)),
            },
          }) as any,
      },
      metrics: createTransferMetrics(),
      policy: createAllowPolicy(),
      config: createTestConfig(),
    });

    await expect(
      downloadService.downloadFileWithProgress("/tmp/remote.txt", localPath, {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("Failed to download");
  });
});
