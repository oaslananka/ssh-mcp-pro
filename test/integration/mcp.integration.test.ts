import { afterAll, beforeAll, describe, expect, vi, test } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createContainer, type AppContainer } from "../../src/container.js";
import { SSHMCPServer } from "../../src/mcp.js";

const TEST_SSH_HOST = process.env.TEST_SSH_HOST || "localhost";
const TEST_SSH_PORT = parseInt(process.env.TEST_SSH_PORT || "2222", 10);
const TEST_SSH_USER = process.env.TEST_SSH_USER || "testuser";
const TEST_SSH_PASS = process.env.TEST_SSH_PASS || "testpass";
const RUN_INTEGRATION = process.env.RUN_SSH_INTEGRATION === "1";
const integrationDescribe = RUN_INTEGRATION ? describe : describe.skip;

const handlerMap = new WeakMap<object, Map<unknown, (request?: unknown) => Promise<unknown>>>();

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

integrationDescribe("MCP integration tests", () => {
  let container: AppContainer;
  let sessionId = "";

  beforeAll(async () => {
    container = createContainer({
      rateLimit: {
        enabled: false,
        maxRequests: 5,
        perSession: {
          enabled: true,
          maxRequests: 50,
          windowMs: 60_000,
        },
        windowMs: 1000,
      },
    });

    const session = await container.sessionManager.openSession({
      host: TEST_SSH_HOST,
      port: TEST_SSH_PORT,
      username: TEST_SSH_USER,
      password: TEST_SSH_PASS,
      auth: "password",
      hostKeyPolicy: "insecure",
    });

    sessionId = session.sessionId;
    container.metrics.recordSessionCreated();
  });

  afterAll(async () => {
    if (sessionId) {
      await container.sessionManager.closeSession(sessionId);
      container.metrics.recordSessionClosed();
    }

    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
    setRequestHandlerSpy.mockRestore();
  });

  test("lists and reads runtime resources through MCP handlers", async () => {
    const server = new SSHMCPServer(container);
    const handlers = getHandlers(server);

    await expect(handlers.get(ListResourcesRequestSchema)?.()).resolves.toEqual(
      expect.objectContaining({
        resources: expect.arrayContaining([
          expect.objectContaining({ uri: "ssh-mcp-pro://sessions/active" }),
        ]),
      }),
    );

    const sessionsResource = (await handlers.get(ReadResourceRequestSchema)?.({
      params: { uri: "ssh-mcp-pro://sessions/active" },
    })) as {
      contents: Array<{ text: string }>;
    };
    const parsedSessions = JSON.parse(sessionsResource.contents[0]?.text ?? "[]") as Array<{
      sessionId?: string;
    }>;

    expect(parsedSessions.some((session) => session.sessionId === sessionId)).toBe(true);

    const metricsResource = (await handlers.get(ReadResourceRequestSchema)?.({
      params: { uri: "ssh-mcp-pro://metrics/prometheus" },
    })) as {
      contents: Array<{ text: string }>;
    };

    expect(metricsResource.contents[0]?.text).toContain("ssh_mcp_sessions_active");
  });

  test("enforces rate limiting through the MCP call boundary", async () => {
    const limited = createContainer({
      rateLimit: {
        enabled: true,
        maxRequests: 1,
        perSession: {
          enabled: true,
          maxRequests: 50,
          windowMs: 60_000,
        },
        windowMs: 60_000,
      },
    });
    const server = new SSHMCPServer(limited);
    const handlers = getHandlers(server);

    const first = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: "ssh_list_sessions", arguments: {} },
    })) as {
      isError?: boolean;
    };
    const second = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: "ssh_list_sessions", arguments: {} },
    })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(first.isError).toBeUndefined();
    expect(second.isError).toBe(true);
    expect(second.content[0]?.text).toContain('"code": "ERATELIMIT"');

    limited.rateLimiter.destroy();
    await limited.sessionManager.destroy();
  });
});
