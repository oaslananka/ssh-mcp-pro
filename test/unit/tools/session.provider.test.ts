import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const getConfiguredHosts = jest.fn() as any;
const resolveSSHHost = jest.fn() as any;

describe("SessionToolProvider", () => {
  beforeEach(() => {
    jest.resetModules();
    getConfiguredHosts.mockReset();
    resolveSSHHost.mockReset();
  });

  async function loadProvider() {
    jest.unstable_mockModule("../../../src/ssh-config.js", () => ({
      getConfiguredHosts,
      resolveSSHHost,
    }));

    return import("../../../src/tools/session.provider.js");
  }

  test("opens, closes, lists, and pings sessions", async () => {
    const { SessionToolProvider } = await loadProvider();
    const openSession = jest.fn(async () => ({
      sessionId: "session-1",
      host: "example.com",
      username: "demo",
      sftpAvailable: true,
      expiresInMs: 1000,
    }));
    const closeSession = jest.fn(async () => true);
    const provider = new SessionToolProvider({
      sessionManager: {
        openSession,
        closeSession,
        getActiveSessions: () => [
          {
            sessionId: "session-1",
            host: "example.com",
            username: "demo",
            port: 22,
            createdAt: 1,
            expiresAt: Date.now() + 1000,
            lastUsed: 1,
          },
        ],
        getSession: () => ({
          ssh: {
            execCommand: jest.fn(async () => ({ code: 0 })),
          },
          info: {
            host: "example.com",
            expiresAt: Date.now() + 1000,
          },
        }),
      } as any,
      metrics: {
        recordSessionCreated: jest.fn(),
        recordSessionClosed: jest.fn(),
      } as any,
    });

    await expect(
      provider.handleTool("ssh_open_session", {
        host: "example.com",
        username: "demo",
      }),
    ).resolves.toEqual(expect.objectContaining({ sessionId: "session-1" }));
    await expect(
      provider.handleTool("ssh_close_session", { sessionId: "session-1" }),
    ).resolves.toBe(true);
    await expect(provider.handleTool("ssh_list_sessions", {})).resolves.toEqual(
      expect.objectContaining({ count: 1 }),
    );
    await expect(provider.handleTool("ssh_ping", { sessionId: "session-1" })).resolves.toEqual(
      expect.objectContaining({ alive: true }),
    );
  });

  test("handles ssh-config backed tools", async () => {
    const { SessionToolProvider } = await loadProvider();
    getConfiguredHosts.mockResolvedValue(["web"]);
    resolveSSHHost.mockResolvedValue({ host: "web.example.com", username: "deploy", port: 22 });
    const provider = new SessionToolProvider({
      sessionManager: {
        getActiveSessions: () => [],
        getSession: () => undefined,
      } as any,
      metrics: {
        recordSessionCreated: jest.fn(),
        recordSessionClosed: jest.fn(),
      } as any,
    });

    await expect(provider.handleTool("ssh_list_configured_hosts", {})).resolves.toEqual(
      expect.objectContaining({
        count: expect.any(Number),
        hosts: expect.any(Array),
      }),
    );
    await expect(provider.handleTool("ssh_resolve_host", { hostAlias: "web" })).resolves.toEqual(
      expect.objectContaining({
        host: expect.any(String),
      }),
    );
    await expect(provider.handleTool("ssh_ping", { sessionId: "missing" })).resolves.toEqual({
      alive: false,
      error: "Session not found or expired",
    });
  });

  test("normalizes optional open-session fields and handles negative close/ping paths", async () => {
    const { SessionToolProvider } = await loadProvider();
    const openSession = jest.fn(async () => ({
      sessionId: "session-2",
      host: "target.example",
      username: "deploy",
      sftpAvailable: false,
      expiresInMs: 5000,
    }));
    const closeSession = jest.fn(async () => false);
    const recordSessionCreated = jest.fn();
    const recordSessionClosed = jest.fn();
    const execCommand = jest
      .fn<() => Promise<{ code: number }>>()
      .mockResolvedValueOnce({ code: 1 })
      .mockRejectedValueOnce(new Error("network down"));
    const provider = new SessionToolProvider({
      sessionManager: {
        openSession,
        closeSession,
        getActiveSessions: () => [],
        getSession: () => ({
          ssh: { execCommand },
          info: {
            host: "target.example",
            expiresAt: Date.now() + 5000,
          },
        }),
      } as any,
      metrics: {
        recordSessionCreated,
        recordSessionClosed,
      } as any,
    });

    await expect(
      provider.handleTool("ssh_open_session", {
        host: "target.example",
        username: "deploy",
        port: 2222,
        auth: "key",
        password: "secret",
        privateKey: "inline-key",
        privateKeyPath: "/tmp/id_ed25519",
        passphrase: "phrase",
        useAgent: true,
        readyTimeoutMs: 7000,
        ttlMs: 15000,
        strictHostKeyChecking: false,
        hostKeyPolicy: "accept-new",
        knownHostsPath: "/tmp/known_hosts",
        expectedHostKeySha256: "SHA256:abc",
        policyMode: "explain",
      }),
    ).resolves.toEqual(expect.objectContaining({ sessionId: "session-2" }));
    expect((openSession as any).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        host: "target.example",
        username: "deploy",
        port: 2222,
        auth: "key",
        password: "secret",
        privateKey: "inline-key",
        privateKeyPath: "/tmp/id_ed25519",
        passphrase: "phrase",
        useAgent: true,
        readyTimeoutMs: 7000,
        ttlMs: 15000,
        strictHostKeyChecking: false,
        hostKeyPolicy: "accept-new",
        knownHostsPath: "/tmp/known_hosts",
        expectedHostKeySha256: "SHA256:abc",
        policyMode: "explain",
      }),
    );
    expect(recordSessionCreated).toHaveBeenCalledTimes(1);

    await expect(
      provider.handleTool("ssh_close_session", { sessionId: "session-2" }),
    ).resolves.toBe(false);
    expect(recordSessionClosed).not.toHaveBeenCalled();

    await expect(provider.handleTool("ssh_ping", { sessionId: "session-2" })).resolves.toEqual(
      expect.objectContaining({ alive: false }),
    );
    await expect(provider.handleTool("ssh_ping", { sessionId: "session-2" })).resolves.toEqual({
      alive: false,
      error: "Connection test failed",
    });
    expect(provider.handleTool("not_a_session_tool", {})).toBeUndefined();
    expect(provider.getTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["ssh_open_session", "ssh_resolve_host"]),
    );
  });
});
