import { describe, expect, vi, test } from "vitest";
import { createPolicyError } from "../../src/errors.js";
import { createFsService } from "../../src/fs-tools.js";
import { PolicyEngine } from "../../src/policy.js";
import { ErrorCode } from "../../src/types.js";
import {
  createAllowPolicy,
  createFileMetrics,
  createSessionInfo,
  createTestConfig,
} from "./helpers.js";

function createLinuxOSInfo() {
  return {
    platform: "linux" as const,
    distro: "ubuntu",
    version: "22.04",
    arch: "x64",
    shell: "bash",
    packageManager: "apt" as const,
    init: "systemd" as const,
    defaultShell: "bash" as const,
  };
}

describe("createFsService", () => {
  test("uses SSH fallback for basic file operations", async () => {
    const execCommand: any = vi.fn();
    execCommand
      .mockResolvedValueOnce({
        code: 0,
        stdout: "file\t5\t1700000000\t644",
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "hello", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "file\t12\t1700000000\t644",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "a.txt\tfile\t5\t1700000000\nb\tdirectory\t0\t1700000001\n",
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const metrics = createFileMetrics();
    const service = createFsService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics,
      policy: createAllowPolicy(),
    } as any);

    await expect(service.readFile("session-1", "/tmp/demo.txt")).resolves.toBe("hello");
    await expect(service.writeFile("session-1", "/tmp/demo.txt", "data", 0o644)).resolves.toBe(
      true,
    );
    await expect(service.statFile("session-1", "/tmp/demo.txt")).resolves.toEqual(
      expect.objectContaining({
        type: "file",
        size: 12,
      }),
    );
    await expect(service.listDirectory("session-1", "/tmp", 0, 1)).resolves.toEqual({
      entries: [
        expect.objectContaining({
          name: "a.txt",
          type: "file",
        }),
      ],
      nextToken: "1",
    });
    await expect(service.makeDirectories("session-1", "/tmp/demo")).resolves.toBe(true);
    await expect(service.removeRecursive("session-1", "/tmp/demo")).resolves.toBe(true);
    await expect(service.renameFile("session-1", "/tmp/a", "/tmp/b")).resolves.toBe(true);

    expect(metrics.recordFileRead).toHaveBeenCalled();
    expect(metrics.recordFileWrite).toHaveBeenCalled();
  });

  test("uses SFTP when available", async () => {
    const existingDirs = new Set<string>(["/existing"]);
    const unlink = vi.fn((_path: string, callback: (err?: Error | null) => void) => callback(null));
    const rmdir = vi.fn((_path: string, callback: (err?: Error | null) => void) => callback(null));
    const rename = vi.fn((_from: string, _to: string, callback: (err?: Error | null) => void) =>
      callback(null),
    );
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            ssh: { execCommand: vi.fn() },
            info: createSessionInfo(),
            sftp: {
              readFile: (_path: string, callback: (err: Error | null, data: Buffer) => void) =>
                callback(null, Buffer.from("hello")),
              writeFile: (
                _path: string,
                _data: Buffer,
                _opts: object,
                callback: (err?: Error | null) => void,
              ) => callback(null),
              chmod: (_path: string, _mode: number, callback: (err?: Error | null) => void) =>
                callback(null),
              rename,
              stat: (
                filePath: string,
                callback: (
                  err: Error | null,
                  stats: { mode?: number; size?: number; mtime?: number },
                ) => void,
              ) => {
                if (filePath === "/tmp/demo.txt") {
                  callback(null, { mode: 0o100644, size: 5, mtime: 1700000000 });
                  return;
                }
                if (filePath === "/root") {
                  callback(null, { mode: 0o040755 });
                  return;
                }
                if (filePath === "/root/nested") {
                  callback(null, { mode: 0o040755 });
                  return;
                }
                if (existingDirs.has(filePath)) {
                  callback(null, { mode: 0o040755 });
                  return;
                }
                callback(new Error("missing"), { mode: 0 });
              },
              readdir: (
                dirPath: string,
                callback: (
                  err: Error | null,
                  list: Array<{
                    filename: string;
                    attrs: { mode?: number; size?: number; mtime?: number };
                  }>,
                ) => void,
              ) => {
                if (dirPath === "/tmp") {
                  callback(null, [
                    { filename: "demo.txt", attrs: { mode: 0o100644, size: 5, mtime: 1700000000 } },
                  ]);
                  return;
                }
                if (dirPath === "/root") {
                  callback(null, [
                    {
                      filename: "child.txt",
                      attrs: { mode: 0o100644, size: 1, mtime: 1700000000 },
                    },
                    { filename: "nested", attrs: { mode: 0o040755, size: 0, mtime: 1700000000 } },
                  ]);
                  return;
                }
                callback(null, []);
              },
              mkdir: (dirPath: string, callback: (err?: Error | null) => void) => {
                existingDirs.add(dirPath);
                callback(null);
              },
              unlink,
              rmdir,
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.readFile("session-1", "/tmp/demo.txt")).resolves.toBe("hello");
    await expect(service.writeFile("session-1", "/tmp/demo.txt", "hello", 0o644)).resolves.toBe(
      true,
    );
    await expect(service.listDirectory("session-1", "/tmp")).resolves.toEqual({
      entries: [
        expect.objectContaining({
          name: "demo.txt",
          type: "file",
        }),
      ],
    });
    await expect(service.makeDirectories("session-1", "/a/b")).resolves.toBe(true);
    await expect(service.removeRecursive("session-1", "/root")).resolves.toBe(true);
    await expect(service.renameFile("session-1", "/tmp/demo.txt", "/tmp/demo2.txt")).resolves.toBe(
      true,
    );
    expect(rename).toHaveBeenCalled();
    expect(unlink).toHaveBeenCalled();
    expect(rmdir).toHaveBeenCalled();
  });

  test("pathExists and type helpers handle failures", async () => {
    const execCommand: any = vi.fn();
    execCommand.mockResolvedValue({ code: 1, stdout: "", stderr: "nope" });
    const service = createFsService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.pathExists("session-1", "/missing")).resolves.toBe(false);
    await expect(service.isDirectory("session-1", "/missing")).resolves.toBe(false);
    await expect(service.isFile("session-1", "/missing")).resolves.toBe(false);
  });

  test("enforces configured file-size limits before reading", async () => {
    const readFile = vi.fn((_path: string, callback: (err: Error | null, data: Buffer) => void) =>
      callback(null, Buffer.from("too large")),
    );
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { execCommand: vi.fn() },
            sftp: {
              readFile,
              stat: (
                _path: string,
                callback: (
                  err: Error | null,
                  stats: { mode?: number; size?: number; mtime?: number },
                ) => void,
              ) => callback(null, { mode: 0o100644, size: 128, mtime: 1700000000 }),
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: { ...createTestConfig(), maxFileSize: 8 },
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.readFile("session-1", "/tmp/large.log")).rejects.toMatchObject({
      code: ErrorCode.ELIMIT,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  test("enforces write-size limits before buffering or writing", async () => {
    const writeFile = vi.fn(
      (_path: string, _data: Buffer, _opts: object, callback: (err?: Error | null) => void) =>
        callback(null),
    );
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { execCommand: vi.fn() },
            sftp: { writeFile },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: { ...createTestConfig(), maxFileWriteBytes: 3 },
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.writeFile("session-1", "/tmp/large.txt", "abcd")).rejects.toMatchObject({
      code: ErrorCode.ELIMIT,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("enforces policy before stat and list access", async () => {
    const stat = vi.fn(
      (_path: string, callback: (err: Error | null, stats: { mode?: number }) => void) =>
        callback(null, { mode: 0o100644 }),
    );
    const readdir = vi.fn(
      (
        _path: string,
        callback: (
          err: Error | null,
          list: Array<{ filename: string; attrs: { mode?: number } }>,
        ) => void,
      ) => callback(null, []),
    );
    const policy = {
      assertAllowed: vi.fn((context: { action: string }) => {
        if (context.action === "fs.stat" || context.action === "fs.list") {
          throw createPolicyError("denied");
        }
        return { allowed: true, mode: "enforce", action: context.action };
      }),
    };
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { execCommand: vi.fn() },
            sftp: { stat, readdir },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy,
    } as any);

    await expect(service.statFile("session-1", "/etc/shadow")).rejects.toMatchObject({
      code: ErrorCode.EPOLICY,
    });
    await expect(service.listDirectory("session-1", "/etc")).rejects.toMatchObject({
      code: ErrorCode.EPOLICY,
    });
    expect(stat).not.toHaveBeenCalled();
    expect(readdir).not.toHaveBeenCalled();
  });

  test("normalizes Windows-style remote paths before filesystem transport", async () => {
    const readFile = vi.fn((_path: string, callback: (err: Error | null, data: Buffer) => void) =>
      callback(null, Buffer.from("secret")),
    );
    const stat = vi.fn(
      (_path: string, callback: (err: Error | null, stats: { mode?: number }) => void) =>
        callback(null, { mode: 0o100644 }),
    );
    const policy = new PolicyEngine({
      mode: "enforce",
      allowRootLogin: false,
      allowRawSudo: false,
      allowDestructiveCommands: false,
      allowDestructiveFs: false,
      allowedHosts: [],
      commandAllow: [],
      commandDeny: [],
      pathAllowPrefixes: ["/tmp"],
      pathDenyPrefixes: ["/etc"],
      localPathAllowPrefixes: [process.cwd()],
      localPathDenyPrefixes: [],
      tunnelAllowBindHosts: [],
      tunnelDenyBindHosts: [],
      tunnelAllowRemoteHosts: [],
      tunnelDenyRemoteHosts: [],
      tunnelAllowPorts: [],
      tunnelDenyPorts: [],
    });
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { execCommand: vi.fn() },
            sftp: { readFile, stat },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy,
    } as any);

    await expect(service.readFile("session-1", "\\etc\\shadow")).rejects.toMatchObject({
      code: ErrorCode.EPOLICY,
    });
    expect(readFile).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  test("does not require fs.stat policy for read size preflight", async () => {
    const readFile = vi.fn((_path: string, callback: (err: Error | null, data: Buffer) => void) =>
      callback(null, Buffer.from("hello")),
    );
    const policy = {
      assertAllowed: vi.fn((context: { action: string }) => {
        if (context.action === "fs.stat") {
          throw createPolicyError("stat denied");
        }
        return { allowed: true, mode: "enforce", action: context.action };
      }),
    };
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { execCommand: vi.fn() },
            sftp: {
              readFile,
              stat: (
                _path: string,
                callback: (
                  err: Error | null,
                  stats: { mode?: number; size?: number; mtime?: number },
                ) => void,
              ) => callback(null, { mode: 0o100644, size: 5, mtime: 1700000000 }),
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy,
    } as any);

    await expect(service.readFile("session-1", "/tmp/readable.txt")).resolves.toBe("hello");
    expect(policy.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fs.read" }),
    );
    expect(policy.assertAllowed).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "fs.stat" }),
    );
  });

  test("handles missing sessions and successful path helpers", async () => {
    const service = createFsService({
      sessionManager: {
        getSession: () => undefined,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.readFile("missing", "/tmp/demo")).rejects.toThrow(
      "Session missing not found or expired",
    );

    const execCommand: any = vi.fn();
    execCommand.mockResolvedValue({
      code: 0,
      stdout: "file\t10\t1700000000\t644",
      stderr: "",
    });
    const activeService = createFsService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(activeService.pathExists("session-1", "/tmp/demo")).resolves.toBe(true);
    await expect(activeService.getFileSize("session-1", "/tmp/demo")).resolves.toBe(10);
    await expect(activeService.isFile("session-1", "/tmp/demo")).resolves.toBe(true);
  });

  test("cleans up temp files when sftp writes fail", async () => {
    const unlink = vi.fn((_path: string, callback: (err?: Error | null) => void) => callback(null));
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            ssh: { execCommand: vi.fn() },
            info: createSessionInfo(),
            sftp: {
              writeFile: (
                _path: string,
                _data: Buffer,
                _opts: object,
                callback: (err?: Error | null) => void,
              ) => callback(new Error("write failed")),
              unlink,
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.writeFile("session-1", "/tmp/demo", "data")).rejects.toMatchObject({
      code: "EFS",
    });
    expect(unlink).toHaveBeenCalled();
    const tempPath = (unlink.mock.calls[0]?.[0] ?? "") as string;
    expect(tempPath).toMatch(/^\/tmp\/\.demo\.[0-9a-f-]{36}\.tmp$/u);
  });

  test("uses stats helper methods and unlinks single files over SFTP", async () => {
    const unlink = vi.fn((_path: string, callback: (err?: Error | null) => void) => callback(null));
    const stat: any = vi.fn();
    stat.mockImplementationOnce(
      (
        _path: string,
        callback: (
          err: Error | null,
          stats: {
            mode?: number;
            size?: number;
            mtime?: number;
            isFile?: () => boolean;
            isDirectory?: () => boolean;
            isSymbolicLink?: () => boolean;
          },
        ) => void,
      ) =>
        callback(null, {
          mode: 0,
          size: 7,
          mtime: 1700000000,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        }),
    );
    stat.mockImplementationOnce(
      (
        _path: string,
        callback: (
          err: Error | null,
          stats: {
            mode?: number;
            size?: number;
            mtime?: number;
            isFile?: () => boolean;
            isDirectory?: () => boolean;
            isSymbolicLink?: () => boolean;
          },
        ) => void,
      ) =>
        callback(null, {
          mode: 0o100644,
          size: 1,
          mtime: 1700000000,
        }),
    );
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            ssh: { execCommand: vi.fn() },
            info: createSessionInfo(),
            sftp: {
              stat,
              unlink,
              readdir: (
                _dirPath: string,
                callback: (
                  err: Error | null,
                  list: Array<{
                    filename: string;
                    attrs: { mode?: number; size?: number; mtime?: number };
                  }>,
                ) => void,
              ) =>
                callback(null, [
                  {
                    filename: "link.txt",
                    attrs: { mode: 0o120777, size: 0, mtime: 1700000000 },
                  },
                ]),
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.statFile("session-1", "/tmp/dir")).resolves.toEqual(
      expect.objectContaining({ type: "directory", size: 7 }),
    );
    await expect(service.listDirectory("session-1", "/tmp")).resolves.toEqual({
      entries: [
        expect.objectContaining({
          name: "link.txt",
          type: "symlink",
        }),
      ],
    });
    await expect(service.removeRecursive("session-1", "/tmp/file")).resolves.toBe(true);
    expect(unlink).toHaveBeenCalledWith("/tmp/file", expect.any(Function));
  });

  test("wraps SFTP read, mkdir, and rename failures", async () => {
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            ssh: { execCommand: vi.fn() },
            info: createSessionInfo(),
            sftp: {
              readFile: (_path: string, callback: (err: Error | null, data: Buffer) => void) =>
                callback(new Error("read failed"), Buffer.alloc(0)),
              stat: (
                _path: string,
                callback: (
                  err: Error | null,
                  stats: { mode?: number; size?: number; mtime?: number },
                ) => void,
              ) => callback(new Error("missing"), { mode: 0 }),
              mkdir: (_path: string, callback: (err?: Error | null) => void) =>
                callback(Object.assign(new Error("mkdir failed"), { code: 2 })),
              rename: (_from: string, _to: string, callback: (err?: Error | null) => void) =>
                callback(new Error("rename failed")),
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.readFile("session-1", "/tmp/demo")).rejects.toMatchObject({ code: "EFS" });
    await expect(service.makeDirectories("session-1", "/tmp/demo")).rejects.toMatchObject({
      code: "EFS",
    });
    await expect(service.renameFile("session-1", "/tmp/a", "/tmp/b")).rejects.toMatchObject({
      code: "EFS",
    });
  });

  test("honors explain mode for write, mkdir, and remove without touching transports", async () => {
    const sftp = {
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };
    const execCommand = vi.fn();
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo({ policyMode: "explain" }),
            ssh: { execCommand },
            sftp,
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.writeFile("session-1", "/tmp/demo", "data")).resolves.toBe(true);
    await expect(service.makeDirectories("session-1", "/tmp/demo")).resolves.toBe(true);
    await expect(service.removeRecursive("session-1", "/tmp/demo")).resolves.toBe(true);

    expect(execCommand).not.toHaveBeenCalled();
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.mkdir).not.toHaveBeenCalled();
    expect(sftp.readdir).not.toHaveBeenCalled();
  });

  test("lists SSH fallback entries without pagination when no page is requested", async () => {
    const execCommand: any = vi.fn();
    execCommand.mockResolvedValue({
      code: 0,
      stdout: "a.txt\tfile\t5\t1700000000\nlink\tsymlink\t0\t1700000001\n",
      stderr: "",
    });
    const service = createFsService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.listDirectory("session-1", "/tmp")).resolves.toEqual({
      entries: [
        expect.objectContaining({ name: "a.txt", type: "file", size: 5 }),
        expect.objectContaining({ name: "link", type: "symlink", size: 0 }),
      ],
    });
  });

  test("covers SFTP stat variants, pagination without next token, and cleanup failure", async () => {
    const unlink = vi.fn((_path: string, callback: (err?: Error | null) => void) =>
      callback(new Error("cleanup failed")),
    );
    const stat: any = vi.fn();
    stat.mockImplementationOnce(
      (
        _path: string,
        callback: (
          err: Error | null,
          stats: {
            mode?: number;
            size?: number;
            mtime?: number;
            isFile?: () => boolean;
            isDirectory?: () => boolean;
            isSymbolicLink?: () => boolean;
          },
        ) => void,
      ) =>
        callback(null, {
          mode: 0,
          size: undefined,
          mtime: undefined,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => true,
        }),
    );
    const service = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            ssh: { execCommand: vi.fn() },
            info: createSessionInfo(),
            sftp: {
              stat,
              readdir: (
                _dirPath: string,
                callback: (
                  err: Error | null,
                  list: Array<{
                    filename: string;
                    attrs: { mode?: number; size?: number; mtime?: number };
                  }>,
                ) => void,
              ) =>
                callback(null, [
                  { filename: "socket", attrs: { mode: 0, size: 0 } },
                  { filename: "dir", attrs: { mode: 0o040755, size: 0, mtime: 1700000000 } },
                ]),
              writeFile: (
                _path: string,
                _data: Buffer,
                _opts: object,
                callback: (err?: Error | null) => void,
              ) => callback(new Error("write failed")),
              unlink,
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.statFile("session-1", "/tmp/link")).resolves.toEqual(
      expect.objectContaining({ type: "symlink", size: 0, mode: 0 }),
    );
    await expect(service.listDirectory("session-1", "/tmp", 0, 10)).resolves.toEqual({
      entries: [
        expect.objectContaining({ name: "socket", type: "other" }),
        expect.objectContaining({ name: "dir", type: "directory" }),
      ],
    });
    await expect(service.writeFile("session-1", "/tmp/demo", "data")).rejects.toMatchObject({
      code: "EFS",
    });
    expect(unlink).toHaveBeenCalled();
  });

  test("fails closed for missing sessions across mutation and metadata helpers", async () => {
    const service = createFsService({
      sessionManager: {
        getSession: () => undefined,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(service.writeFile("missing", "/tmp/demo", "data")).rejects.toThrow(
      "Session missing not found or expired",
    );
    await expect(service.statFile("missing", "/tmp/demo")).rejects.toThrow(
      "Session missing not found or expired",
    );
    await expect(service.listDirectory("missing", "/tmp")).rejects.toThrow(
      "Session missing not found or expired",
    );
    await expect(service.makeDirectories("missing", "/tmp/demo")).rejects.toThrow(
      "Session missing not found or expired",
    );
    await expect(service.removeRecursive("missing", "/tmp/demo")).rejects.toThrow(
      "Session missing not found or expired",
    );
    await expect(service.renameFile("missing", "/tmp/a", "/tmp/b")).rejects.toThrow(
      "Session missing not found or expired",
    );
  });

  test("covers fallback defaults and mkdir race tolerance", async () => {
    const execCommand: any = vi.fn();
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: "\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "name-only\n", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    const fallbackService = createFsService({
      sessionManager: {
        getSession: () => ({ info: createSessionInfo(), ssh: { execCommand } }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(fallbackService.statFile("session-1", "/tmp/blank")).resolves.toEqual(
      expect.objectContaining({ size: 0, type: "" }),
    );
    await expect(fallbackService.listDirectory("session-1", "/tmp")).resolves.toEqual({
      entries: [expect.objectContaining({ name: "name-only", type: "other", size: 0 })],
    });
    await expect(fallbackService.readFile("session-1", "/tmp/fail")).rejects.toMatchObject({
      code: "EFS",
    });

    const mkdir = vi.fn((_path: string, callback: (err?: Error | null) => void) =>
      callback(Object.assign(new Error("already exists"), { code: 4 })),
    );
    const mkdirRaceService = createFsService({
      sessionManager: {
        getSession: () =>
          ({
            info: createSessionInfo(),
            ssh: { execCommand: vi.fn() },
            sftp: {
              stat: (
                _path: string,
                callback: (err: Error | null, stats: { mode?: number }) => void,
              ) => callback(new Error("missing"), { mode: 0 }),
              mkdir,
            },
          }) as any,
        getOSInfo: async () => createLinuxOSInfo(),
      },
      config: createTestConfig(),
      metrics: createFileMetrics(),
      policy: createAllowPolicy(),
    } as any);

    await expect(mkdirRaceService.makeDirectories("session-1", "relative/path")).resolves.toBe(
      true,
    );
    expect(mkdir).toHaveBeenCalled();
  });
});
