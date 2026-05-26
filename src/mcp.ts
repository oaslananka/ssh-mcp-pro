import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppContainer } from "./container.js";
import { logger } from "./logging.js";
import { listResources, readResource } from "./resources.js";
import { getMCPPrompt, listMCPPrompts } from "./prompts.js";
import { withSpan } from "./telemetry.js";
import { createToolRegistry } from "./tools/index.js";
import type { ToolProfile } from "./connector-profile.js";
import type { RateLimitResult } from "./rate-limiter.js";

export const SERVER_VERSION = "1.1.0"; // x-release-please-version
export const SERVER_NAME = "io.github.oaslananka/ssh-mcp-pro";

function getSessionIdFromArgs(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  const sessionId = (args as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return undefined;
  }

  return sessionId;
}

function rateLimitErrorResult(
  toolName: string,
  rateCheck: Pick<RateLimitResult, "resetIn">,
  scope: "global" | "session",
  sessionId?: string,
) {
  const payload = {
    error: true,
    code: "ERATELIMIT",
    message:
      scope === "session" && sessionId
        ? `Rate limit exceeded for session ${sessionId} while calling tool: ${toolName}`
        : `Rate limit exceeded for tool: ${toolName}`,
    resetIn: rateCheck.resetIn,
    scope,
    ...(sessionId ? { sessionId } : {}),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: true,
  };
}

export class SSHMCPServer {
  private readonly server: Server;
  private readonly registry: ReturnType<typeof createToolRegistry>;
  private readonly toolProfile: ToolProfile;

  constructor(private readonly container: AppContainer) {
    this.toolProfile = container.config.get("connector").toolProfile;
    this.server = new Server(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );
    this.registry = createToolRegistry(container);

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () =>
      withSpan(
        "mcp.list_resources",
        async (span) => {
          span.setAttribute("mcp.request.kind", "list_resources");
          span.setAttribute("mcp.tool_profile", this.toolProfile);
          return listResources(this.toolProfile);
        },
        {
          attributes: {
            "mcp.request.kind": "list_resources",
          },
        },
      ),
    );

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      withSpan(
        "mcp.read_resource",
        async (span) => {
          span.setAttribute("mcp.request.kind", "read_resource");
          span.setAttribute("mcp.resource.uri", request.params.uri);
          span.setAttribute("mcp.tool_profile", this.toolProfile);
          return readResource(request.params.uri, this.container, this.toolProfile);
        },
        {
          attributes: {
            "mcp.request.kind": "read_resource",
            "mcp.resource.uri": request.params.uri,
          },
        },
      ),
    );

    this.server.setRequestHandler(ListPromptsRequestSchema, async () =>
      withSpan(
        "mcp.list_prompts",
        async (span) => {
          span.setAttribute("mcp.request.kind", "list_prompts");
          span.setAttribute("mcp.tool_profile", this.toolProfile);
          return listMCPPrompts(this.toolProfile);
        },
        {
          attributes: {
            "mcp.request.kind": "list_prompts",
          },
        },
      ),
    );

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) =>
      withSpan(
        "mcp.get_prompt",
        async (span) => {
          span.setAttribute("mcp.request.kind", "get_prompt");
          span.setAttribute("mcp.prompt.name", request.params.name);
          span.setAttribute("mcp.tool_profile", this.toolProfile);
          return getMCPPrompt(
            request.params.name,
            request.params.arguments ?? {},
            this.toolProfile,
          );
        },
        {
          attributes: {
            "mcp.request.kind": "get_prompt",
            "mcp.prompt.name": request.params.name,
          },
        },
      ),
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.getAllTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      withSpan(
        "mcp.call_tool",
        async (span) => {
          const { name, arguments: args } = request.params;

          span.setAttribute("mcp.request.kind", "call_tool");
          span.setAttribute("mcp.tool.name", name);

          const rateLimit = this.container.config.get("rateLimit");
          if (rateLimit.enabled) {
            const rateCheck = this.container.rateLimiter.check("global");
            if (!rateCheck.allowed) {
              span.setAttribute("mcp.rate_limited", true);
              span.setAttribute("mcp.rate_limit.scope", "global");
              return rateLimitErrorResult(name, rateCheck, "global");
            }

            const sessionId = getSessionIdFromArgs(args);
            if (sessionId && rateLimit.perSession.enabled) {
              const sessionCheck = this.container.rateLimiter.check(`session:${sessionId}`, {
                maxRequests: rateLimit.perSession.maxRequests,
                windowMs: rateLimit.perSession.windowMs,
              });
              if (!sessionCheck.allowed) {
                span.setAttribute("mcp.rate_limited", true);
                span.setAttribute("mcp.rate_limit.scope", "session");
                span.setAttribute("mcp.session.id", sessionId);
                return rateLimitErrorResult(name, sessionCheck, "session", sessionId);
              }
            }
          }

          span.setAttribute("mcp.rate_limited", false);
          return this.registry.dispatch(name, args ?? {});
        },
        {
          attributes: {
            "mcp.request.kind": "call_tool",
            "mcp.tool.name": request.params.name,
          },
        },
      ),
    );
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      logger.error("Server error", {
        error: error instanceof Error ? error.message : String(error),
      });
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.connect(transport);
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
    logger.info("SSH MCP Server started successfully");
  }
}
