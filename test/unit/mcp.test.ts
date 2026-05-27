import { afterAll, beforeEach, describe, expect, vi, test } from "vitest";
import { readFileSync } from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppContainer } from "../../src/container.js";
import { ConfigManager, type ServerConfig } from "../../src/config.js";
import { createTestContainer } from "./helpers.js";
import { logger } from "../../src/logging.js";
import { SERVER_NAME, SERVER_VERSION, SSHMCPServer } from "../../src/mcp.js";
import { RateLimiter } from "../../src/rate-limiter.js";

type PackageMetadata = {
  name: string;
  mcpName: string;
  version: string;
};

type ServerMetadata = {
  name: string;
  title: string;
  version: string;
  packages: Array<{
    identifier: string;
    version: string;
    transport?: {
      type?: string;
    };
  }>;
};

type RegistryMetadata = {
  name: string;
  display_name: string;
  version: string;
  entrypoint: string;
  transport: string;
  capabilities?: Record<string, boolean>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const packageMetadata = readJson<PackageMetadata>("package.json");
const serverMetadata = readJson<ServerMetadata>("server.json");
const mcpMetadata = readJson<RegistryMetadata>("mcp.json");
const registryMetadata = readJson<RegistryMetadata>("registry/ssh-mcp-pro/mcp.json");

const handlerMap = new WeakMap<object, Map<unknown, (request?: unknown) => Promise<unknown>>>();

const connectSpy = vi.spyOn(Server.prototype as any, "connect").mockResolvedValue(undefined);
const setRequestHandlerSpy = vi
  .spyOn(Server.prototype as any, "setRequestHandler")
  .mockImplementation(function (
    this: object,
    schema: unknown,
    handler: (request?: unknown) => Promise<unknown>,
  ) {
    const handlers = handlerMap.get(this) ?? new Map();
    handlers.set(schema, handler);
    handlerMap.set(this, handlers);
  } as any);

function getHandlers(server: SSHMCPServer) {
  const internalServer = (server as unknown as { server: object }).server;
  const handlers = handlerMap.get(internalServer);
  if (!handlers) {
    throw new Error("request handlers were not registered");
  }
  return handlers;
}

async function destroyContainer(container: AppContainer): Promise<void> {
  container.rateLimiter.destroy();
  await container.sessionManager.destroy();
}

function enabledRateLimitConfig(overrides: Partial<ServerConfig["rateLimit"]> = {}) {
  return {
    enabled: true,
    maxRequests: 100,
    perSession: {
      enabled: true,
      maxRequests: 50,
      windowMs: 60_000,
    },
    windowMs: 60_000,
    ...overrides,
  };
}

function parseToolPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("SSHMCPServer", () => {
  const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    connectSpy.mockClear();
    infoSpy.mockClear();
    errorSpy.mockClear();
  });

  afterAll(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    connectSpy.mockRestore();
    setRequestHandlerSpy.mockRestore();
  });

  test("exposes the server version constant", () => {
    expect(SERVER_VERSION).toBe(packageMetadata.version);
    expect(SERVER_NAME).toBe(packageMetadata.mcpName);
  });

  test("keeps MCP metadata files aligned with runtime server identity", () => {
    expect(packageMetadata.name).toBe("ssh-mcp-pro");
    expect(packageMetadata.mcpName).toBe("io.github.oaslananka/ssh-mcp-pro");
    expect(SERVER_NAME).toBe(packageMetadata.mcpName);
    expect(SERVER_VERSION).toBe(packageMetadata.version);

    expect(serverMetadata.name).toBe(SERVER_NAME);
    expect(serverMetadata.title).toBe(packageMetadata.name);
    expect(serverMetadata.version).toBe(SERVER_VERSION);
    expect(
      serverMetadata.packages.map((packageEntry) => ({
        identifier: packageEntry.identifier,
        version: packageEntry.version,
        transport: packageEntry.transport?.type,
      })),
    ).toEqual([
      {
        identifier: packageMetadata.name,
        version: SERVER_VERSION,
        transport: "stdio",
      },
      {
        identifier: packageMetadata.name,
        version: SERVER_VERSION,
        transport: "streamable-http",
      },
    ]);

    const expectedRegistryIdentity = {
      name: packageMetadata.name,
      display_name: packageMetadata.name,
      version: SERVER_VERSION,
      entrypoint: "dist/index.js",
      transport: "stdio",
    };

    expect(mcpMetadata).toMatchObject(expectedRegistryIdentity);
    expect(registryMetadata).toMatchObject(expectedRegistryIdentity);
    expect(registryMetadata.capabilities).toEqual(mcpMetadata.capabilities);
  });

  test("returns the canonical server identity during initialize", async () => {
    const container = createTestContainer();
    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);

    try {
      await expect(
        handlers.get(InitializeRequestSchema)?.({
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: "metadata-contract-test",
              version: "0.0.0",
            },
          },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: {
            name: packageMetadata.mcpName,
            version: packageMetadata.version,
          },
        }),
      );
    } finally {
      await destroyContainer(container);
    }
  });

  test("registers handlers and delegates tool calls when rate limiting is disabled", async () => {
    const container = createTestContainer();
    const rateCheckSpy = vi.spyOn(container.rateLimiter, "check");
    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);

    await expect(handlers.get(ListResourcesRequestSchema)?.()).resolves.toEqual(
      expect.objectContaining({
        resources: expect.arrayContaining([
          expect.objectContaining({ uri: "ssh-mcp-pro://sessions/active" }),
          expect.objectContaining({ uri: "ssh-mcp-pro://metrics/json" }),
        ]),
      }),
    );

    await expect(
      handlers.get(ReadResourceRequestSchema)?.({
        params: { uri: "ssh-mcp-pro://metrics/json" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            uri: "ssh-mcp-pro://metrics/json",
            mimeType: "application/json",
            text: expect.stringContaining('"sessions"'),
          }),
        ],
      }),
    );

    await expect(handlers.get(ListToolsRequestSchema)?.()).resolves.toEqual(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "connector_status" }),
          expect.objectContaining({ name: "ssh_open_session" }),
          expect.objectContaining({ name: "get_metrics" }),
        ]),
      }),
    );

    await expect(handlers.get(ListPromptsRequestSchema)?.()).resolves.toEqual(
      expect.objectContaining({
        prompts: expect.arrayContaining([
          expect.objectContaining({ name: "safe-connect" }),
          expect.objectContaining({ name: "plan-mutation" }),
        ]),
      }),
    );

    await expect(
      handlers.get(GetPromptRequestSchema)?.({
        params: {
          name: "safe-connect",
          arguments: { host: "prod-1", username: "deploy" },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.objectContaining({
              text: expect.stringContaining("prod-1"),
            }),
          }),
        ]),
      }),
    );

    const result = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: "ssh_list_sessions", arguments: {} },
    })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      count?: number;
      sessions?: unknown[];
    };

    expect(result.isError).toBeUndefined();
    expect(payload.count).toBe(0);
    expect(payload.sessions).toEqual([]);
    expect(rateCheckSpy).not.toHaveBeenCalled();

    await destroyContainer(container);
  });

  test("remote connector profile hides credential-taking and mutation tools", async () => {
    const base = createTestContainer();
    const container = {
      ...base,
      config: {
        get: vi.fn((key: string) =>
          key === "connector"
            ? {
                toolProfile: "remote-readonly",
                credentialProvider: "none",
                credentialCommandArgs: [],
                credentialCommandTimeoutMs: 5000,
              }
            : base.config.get(key as never),
        ),
        getAll: vi.fn(() => ({
          ...base.config.getAll(),
          connector: {
            toolProfile: "remote-readonly" as const,
            credentialProvider: "none" as const,
            credentialCommandArgs: [],
            credentialCommandTimeoutMs: 5000,
          },
        })),
      },
    } as unknown as AppContainer;

    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);
    const listTools = (await handlers.get(ListToolsRequestSchema)?.()) as {
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    };
    const toolNames = listTools.tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "connector_status",
        "ssh_hosts_list",
        "ssh_policy_explain",
        "ssh_host_inspect",
        "ssh_mutation_plan",
      ]),
    );
    expect(toolNames).not.toEqual(expect.arrayContaining(["ssh_open_session", "proc_exec"]));
    expect(JSON.stringify(listTools.tools)).not.toMatch(
      /"password"|"privateKey"|"privateKeyPath"|"passphrase"|"sudoPassword"/,
    );

    await expect(
      handlers.get(CallToolRequestSchema)?.({
        params: { name: "ssh_open_session", arguments: {} },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        isError: true,
        structuredContent: expect.objectContaining({ code: "ETOOLPROFILE" }),
      }),
    );

    await destroyContainer(base);
  });

  test("returns an error response when the rate limit blocks a tool call", async () => {
    const base = createTestContainer();
    const container = {
      ...base,
      config: {
        get: vi.fn((key: string) =>
          key === "rateLimit" ? enabledRateLimitConfig() : base.config.get(key as never),
        ),
        getAll: vi.fn(() => ({
          ...base.config.getAll(),
          rateLimit: enabledRateLimitConfig(),
        })),
      },
      rateLimiter: {
        check: vi.fn(() => ({ allowed: false, resetIn: 1234 })),
        destroy: vi.fn(),
      },
    } as unknown as AppContainer;

    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);

    await expect(
      handlers.get(CallToolRequestSchema)?.({
        params: { name: "ssh_list_sessions", arguments: { sessionId: "session-1" } },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        isError: true,
        content: [
          expect.objectContaining({
            text: expect.stringContaining('"code": "ERATELIMIT"'),
          }),
        ],
      }),
    );

    expect(container.rateLimiter.check as any).toHaveBeenCalledWith("global");
    expect(container.rateLimiter.check as any).toHaveBeenCalledTimes(1);

    await destroyContainer(base);
  });

  test("returns a session-scoped rate limit error without exhausting the global limit", async () => {
    const base = createTestContainer();
    const rateLimitConfig = enabledRateLimitConfig({
      perSession: {
        enabled: true,
        maxRequests: 2,
        windowMs: 1_000,
      },
    });
    const container = {
      ...base,
      config: {
        get: vi.fn((key: string) =>
          key === "rateLimit" ? rateLimitConfig : base.config.get(key as never),
        ),
        getAll: vi.fn(() => ({
          ...base.config.getAll(),
          rateLimit: rateLimitConfig,
        })),
      },
      rateLimiter: {
        check: vi
          .fn()
          .mockReturnValueOnce({ allowed: true, resetIn: 60_000 })
          .mockReturnValueOnce({ allowed: false, resetIn: 321 }),
        destroy: vi.fn(),
      },
    } as unknown as AppContainer;

    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);
    const result = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: "proc_exec", arguments: { sessionId: "session-1", command: "uptime" } },
    })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toEqual(
      expect.objectContaining({
        code: "ERATELIMIT",
        error: true,
        resetIn: 321,
        scope: "session",
        sessionId: "session-1",
      }),
    );
    expect(container.rateLimiter.check as any).toHaveBeenNthCalledWith(1, "global");
    expect(container.rateLimiter.check as any).toHaveBeenNthCalledWith(2, "session:session-1", {
      maxRequests: 2,
      windowMs: 1_000,
    });

    await destroyContainer(base);
  });

  test("keeps session rate limit buckets isolated and resets them after the session window", async () => {
    let now = 10_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const container = createTestContainer({
      config: new ConfigManager({
        rateLimit: {
          enabled: true,
          maxRequests: 100,
          perSession: {
            enabled: true,
            maxRequests: 1,
            windowMs: 50,
          },
          windowMs: 1_000,
        },
      }),
      rateLimiter: new RateLimiter({
        maxRequests: 100,
        windowMs: 1_000,
        blockOnLimit: true,
      }),
    });
    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);

    try {
      const firstSessionA = (await handlers.get(CallToolRequestSchema)?.({
        params: { name: "ssh_list_sessions", arguments: { sessionId: "session-a" } },
      })) as { isError?: boolean };
      const secondSessionA = (await handlers.get(CallToolRequestSchema)?.({
        params: { name: "ssh_list_sessions", arguments: { sessionId: "session-a" } },
      })) as { isError?: boolean; content: Array<{ text: string }> };
      const firstSessionB = (await handlers.get(CallToolRequestSchema)?.({
        params: { name: "ssh_list_sessions", arguments: { sessionId: "session-b" } },
      })) as { isError?: boolean };

      now += 60;

      const sessionAAfterReset = (await handlers.get(CallToolRequestSchema)?.({
        params: { name: "ssh_list_sessions", arguments: { sessionId: "session-a" } },
      })) as { isError?: boolean };

      expect(firstSessionA.isError).toBeUndefined();
      expect(secondSessionA.isError).toBe(true);
      expect(parseToolPayload(secondSessionA)).toEqual(
        expect.objectContaining({
          scope: "session",
          sessionId: "session-a",
        }),
      );
      expect(firstSessionB.isError).toBeUndefined();
      expect(sessionAAfterReset.isError).toBeUndefined();
    } finally {
      await destroyContainer(container);
      nowSpy.mockRestore();
    }
  });

  test("skips the session limiter when per-session limits are disabled", async () => {
    const base = createTestContainer();
    const rateLimitConfig = enabledRateLimitConfig({
      perSession: {
        enabled: false,
        maxRequests: 1,
        windowMs: 50,
      },
    });
    const container = {
      ...base,
      config: {
        get: vi.fn((key: string) =>
          key === "rateLimit" ? rateLimitConfig : base.config.get(key as never),
        ),
        getAll: vi.fn(() => ({
          ...base.config.getAll(),
          rateLimit: rateLimitConfig,
        })),
      },
      rateLimiter: {
        check: vi.fn(() => ({ allowed: true, resetIn: 60_000 })),
        destroy: vi.fn(),
      },
    } as unknown as AppContainer;

    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);
    const result = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: "ssh_list_sessions", arguments: { sessionId: "session-disabled" } },
    })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(parseToolPayload(result)).toEqual(expect.objectContaining({ count: 0 }));
    expect(container.rateLimiter.check as any).toHaveBeenCalledWith("global");
    expect(container.rateLimiter.check as any).toHaveBeenCalledTimes(1);

    await destroyContainer(base);
  });

  test("delegates allowed rate-limited calls and defaults missing arguments", async () => {
    const base = createTestContainer();
    const container = {
      ...base,
      config: {
        get: vi.fn((key: string) =>
          key === "rateLimit" ? enabledRateLimitConfig() : base.config.get(key as never),
        ),
        getAll: vi.fn(() => ({
          ...base.config.getAll(),
          rateLimit: enabledRateLimitConfig(),
        })),
      },
      rateLimiter: {
        check: vi.fn(() => ({ allowed: true, resetIn: 0 })),
        destroy: vi.fn(),
      },
    } as unknown as AppContainer;

    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);
    const result = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: "ssh_list_sessions" },
    })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"count"');
    expect(container.rateLimiter.check as any).toHaveBeenCalledWith("global");

    await destroyContainer(base);
  });

  test("logs server errors and connects transports in run()", async () => {
    const container = createTestContainer();
    const server = new SSHMCPServer(container);
    const internalServer = (
      server as unknown as {
        server: { onerror?: (error: Error) => void };
      }
    ).server;

    internalServer.onerror?.(new Error("boom"));
    internalServer.onerror?.("string-error" as unknown as Error);
    await server.run();

    expect(errorSpy).toHaveBeenCalledWith("Server error", {
      error: "boom",
    });
    expect(errorSpy).toHaveBeenCalledWith("Server error", {
      error: "string-error",
    });
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith("SSH MCP Server started successfully");

    await destroyContainer(container);
  });
});
