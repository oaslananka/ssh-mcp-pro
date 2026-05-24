/**
 * E2E tests for SSH MCP Server
 *
 * These tests require a test SSH server to be available.
 * Set RUN_SSH_E2E=1 environment variable to enable these tests.
 *
 * Quick start with Docker:
 * pnpm run e2e:docker
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createContainer, type AppContainer } from "../../src/container.js";
import { detectOS } from "../../src/detect.js";
import { createFsService, type FsService } from "../../src/fs-tools.js";
import { createProcessService, type ProcessService } from "../../src/process.js";
import { createStreamingService, type StreamingService } from "../../src/streaming.js";

const TEST_SSH_HOST = process.env.TEST_SSH_HOST || "localhost";
const TEST_SSH_PORT = parseInt(process.env.TEST_SSH_PORT || "2222", 10);
const TEST_SSH_USER = process.env.TEST_SSH_USER || "testuser";
const TEST_SSH_PASS = process.env.TEST_SSH_PASS || "testpass";
const RUN_E2E = process.env.RUN_SSH_E2E === "1";
const e2eDescribe = RUN_E2E ? describe : describe.skip;

e2eDescribe("SSH MCP Server E2E Tests", () => {
  let container: AppContainer;
  let processService: ProcessService;
  let fsService: FsService;
  let streamingService: StreamingService;
  let sessionId = "";

  beforeAll(async () => {
    container = createContainer({
      security: {
        allowRootLogin: false,
        allowedCiphers: [],
        hostKeyPolicy: "insecure",
        knownHostsPath: "",
      },
      policy: {
        mode: "enforce",
        allowRootLogin: false,
        allowRawSudo: false,
        allowDestructiveCommands: true,
        allowDestructiveFs: false,
        allowedHosts: [],
        commandAllow: [],
        commandDeny: [],
        pathAllowPrefixes: ["/tmp"],
        pathDenyPrefixes: [],
        localPathAllowPrefixes: [],
        localPathDenyPrefixes: [],
        tunnelAllowBindHosts: ["127.0.0.1", "localhost", "::1"],
        tunnelDenyBindHosts: ["0.0.0.0", "::"],
        tunnelAllowRemoteHosts: [],
        tunnelDenyRemoteHosts: [],
        tunnelAllowPorts: [],
        tunnelDenyPorts: [],
      },
    });
    processService = createProcessService({
      sessionManager: container.sessionManager,
      config: container.config.getAll(),
      policy: container.policy,
    });
    fsService = createFsService({
      sessionManager: container.sessionManager,
      metrics: container.metrics,
      config: container.config.getAll(),
      policy: container.policy,
    });
    streamingService = createStreamingService({
      sessionManager: container.sessionManager,
      config: container.config.getAll(),
      policy: container.policy,
    });

    const result = await container.sessionManager.openSession({
      host: TEST_SSH_HOST,
      port: TEST_SSH_PORT,
      username: TEST_SSH_USER,
      password: TEST_SSH_PASS,
      auth: "password",
      hostKeyPolicy: "insecure",
    });

    sessionId = result.sessionId;
  });

  afterAll(async () => {
    if (!container) {
      return;
    }

    if (sessionId) {
      await container.sessionManager.closeSession(sessionId);
      sessionId = "";
    }

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
  });

  test("connects via password authentication", () => {
    expect(sessionId).toBeTruthy();
  });

  test("lists active sessions", () => {
    const sessions = container.sessionManager.getActiveSessions();

    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.some((session) => session.sessionId === sessionId)).toBe(true);
  });

  test("checks session health", async () => {
    await expect(container.sessionManager.isSessionAlive(sessionId)).resolves.toBe(true);
  });

  test("executes basic commands", async () => {
    const result = await processService.execCommand(sessionId, 'echo "Hello World"');

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("Hello World");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test("executes commands with environment variables", async () => {
    const result = await processService.execCommand(sessionId, "echo $MY_VAR", undefined, {
      MY_VAR: "test123",
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("test123");
  });

  test("executes commands with working directory", async () => {
    const result = await processService.execCommand(sessionId, "pwd", "/tmp");

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp");
  });

  test("handles command timeout", async () => {
    await expect(
      processService.execCommand(sessionId, "sleep 10", undefined, undefined, 1000),
    ).rejects.toMatchObject({ code: "ETIMEOUT" });
  });

  test("writes, reads, stats, lists, and cleans up files", async () => {
    const testFilePath = "/tmp/ssh-mcp-pro-test-file.txt";
    const testDirPath = "/tmp/ssh-mcp-pro-test-dir/nested";
    const testContent = "Hello from ssh-mcp-pro!";

    await expect(fsService.writeFile(sessionId, testFilePath, testContent)).resolves.toBe(true);
    await expect(fsService.readFile(sessionId, testFilePath)).resolves.toBe(testContent);

    const stats = await fsService.statFile(sessionId, testFilePath);
    expect(stats.type).toBe("file");
    expect(stats.size).toBeGreaterThan(0);

    const listing = await fsService.listDirectory(sessionId, "/tmp");
    expect(Array.isArray(listing.entries)).toBe(true);
    expect(listing.entries.some((entry) => entry.name === "ssh-mcp-pro-test-file.txt")).toBe(true);

    await expect(fsService.makeDirectories(sessionId, testDirPath)).resolves.toBe(true);

    await expect(fsService.removeRecursive(sessionId, testFilePath)).resolves.toBe(true);
    await expect(fsService.removeRecursive(sessionId, "/tmp/ssh-mcp-pro-test-dir")).resolves.toBe(
      true,
    );
  });

  test("detects OS information", async () => {
    const session = container.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error("session not found");
    }

    const osInfo = await detectOS(session.ssh);
    expect(osInfo.arch).toBeDefined();
    expect(osInfo.shell).toBeDefined();
  });

  test("streams command output", async () => {
    const chunks: Array<{ data?: string }> = [];
    const result = await streamingService.execWithStreaming({
      sessionId,
      command: 'for i in 1 2 3; do echo "Line $i"; sleep 0.1; done',
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(result.code).toBe(0);
    expect(chunks.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Line 1");
  });

  test("closes the session", async () => {
    await expect(container.sessionManager.closeSession(sessionId)).resolves.toBe(true);
    expect(container.sessionManager.getSession(sessionId)).toBeUndefined();
    sessionId = "";
  });
});

export {};
