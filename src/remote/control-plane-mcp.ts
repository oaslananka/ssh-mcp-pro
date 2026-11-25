import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpHandler, isLegacyRequest, McpServer } from "@modelcontextprotocol/server";
import { toMcpWebRequest, sendMcpWebResponse } from "../mcp-http-web.js";
import {
  isRecord,
  asString,
  negotiateMcpProtocolVersion,
  safeError,
  readJson,
} from "./http-util.js";
import { listRemoteToolDescriptors } from "./mcp-tools.js";
import type { RemoteConfig, RemotePrincipal, RemoteToolName } from "./types.js";
import { TOOL_CAPABILITY_MAP } from "./types.js";
import { jsonResponse } from "./util.js";
import { SERVER_VERSION } from "../mcp.js";

/** Public MCP server identity advertised to all remote hosts. */
export const REMOTE_MCP_SERVER_NAME = "ssh-mcp-pro";

export class RemoteMcpRequestHandler {
  constructor(
    private readonly config: RemoteConfig,
    private readonly authenticate: (req: IncomingMessage) => Promise<RemotePrincipal>,
    private readonly callRemoteTool: (
      principal: RemotePrincipal,
      tool: RemoteToolName,
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>,
  ) {}

  async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      this.sendUnauthorized(res);
      return;
    }
    let principal: RemotePrincipal;
    try {
      principal = await this.authenticate(req);
    } catch {
      this.sendUnauthorized(res);
      return;
    }
    const body = await readJson(req);
    const request = toMcpWebRequest(req, body);
    // The official SDK validates the modern request envelope, mirrored HTTP
    // headers, protocol version and output shape. Legacy clients retain their
    // existing authenticated 2025-era behavior.
    // Preserve the previous error response for an unclaimed 2025-era
    // tools/call with malformed params. The SDK rightly classifies this
    // malformed message as invalid; no modern version/header may downgrade.
    const malformedLegacyCall =
      body.method === "tools/call" &&
      !isRecord(body.params) &&
      req.headers["mcp-protocol-version"] === undefined &&
      req.headers["mcp-method"] === undefined &&
      !("_meta" in body);
    if (!malformedLegacyCall && !(await isLegacyRequest(request, body))) {
      await this.handleModernMcp(request, res, principal);
      return;
    }
    const method = asString(body.method) ?? "";
    const rpcId = body.id ?? null;
    if (method === "initialize") {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          protocolVersion: negotiateMcpProtocolVersion(body.params),
          capabilities: { tools: {} },
          serverInfo: { name: REMOTE_MCP_SERVER_NAME, version: SERVER_VERSION },
        },
      });
      return;
    }
    if (method === "tools/list") {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        result: { tools: listRemoteToolDescriptors(principal.capabilities, principal.provider) },
      });
      return;
    }
    if (method === "tools/call") {
      await this.handleMcpToolCall(principal, body, rpcId, res);
      return;
    }
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id: rpcId,
      error: { code: -32601, message: "Method not found" },
    });
  }

  /**
   * Instantiate the SDK handler only after validating this request's bearer
   * token. No session-wide principal or global tool registry is shared between
   * callers, so concurrent requests cannot inherit one another's scopes.
   */
  private async handleModernMcp(
    request: Request,
    response: ServerResponse,
    principal: RemotePrincipal,
  ): Promise<void> {
    const handler = createMcpHandler(
      () => {
        const server = new McpServer(
          { name: REMOTE_MCP_SERVER_NAME, version: SERVER_VERSION },
          { capabilities: { tools: {} } },
        );
        server.server.setRequestHandler("tools/list", () => ({
          tools: listRemoteToolDescriptors(principal.capabilities, principal.provider).map(
            ({ capability: _capability, ...tool }) => ({
              ...tool,
              inputSchema: { ...tool.inputSchema, type: "object" as const },
            }),
          ),
        }));
        server.server.setRequestHandler("tools/call", async (rpc) => {
          const name = rpc.params.name;
          if (!Object.hasOwn(TOOL_CAPABILITY_MAP, name)) {
            throw safeError("INVALID_SCOPE", "Unknown tool", 400);
          }
          try {
            const result = await this.callRemoteTool(
              principal,
              name as RemoteToolName,
              rpc.params.arguments ?? {},
            );
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              structuredContent: result,
            };
          } catch (error) {
            // An interrupted execution is a tool outcome, not a transport failure.
            if (isRecord(error) && error.code === "ACTION_OUTCOME_UNKNOWN") {
              const result = { code: error.code, message: String(error.message) };
              return {
                isError: true,
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
              };
            }
            throw error;
          }
        });
        return server;
      },
      { legacy: "reject" },
    );

    try {
      await sendMcpWebResponse(response, await handler.fetch(request));
    } finally {
      await handler.close();
    }
  }

  private async handleMcpToolCall(
    principal: RemotePrincipal,
    body: Record<string, unknown>,
    rpcId: unknown,
    res: ServerResponse,
  ): Promise<void> {
    const params = isRecord(body.params) ? body.params : {};
    const name = asString(params.name) as RemoteToolName | undefined;
    const args = isRecord(params.arguments) ? params.arguments : {};
    if (!name || !(name in TOOL_CAPABILITY_MAP)) {
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        error: { code: -32602, message: "Unknown tool" },
      });
      return;
    }
    let callResult: unknown;
    try {
      callResult = await this.callRemoteTool(principal, name, args);
    } catch (error) {
      const isStructured = error !== null && typeof error === "object" && "message" in error;
      const message = isStructured
        ? String((error as { message: string }).message)
        : "Tool call failed";
      const errorCode =
        isStructured && "code" in error
          ? String((error as { code: string }).code)
          : "TOOL_CALL_FAILED";
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id: rpcId,
        error: { code: -32000, message, data: { code: errorCode } },
      });
      return;
    }
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        content: [{ type: "text", text: JSON.stringify(callResult, null, 2) }],
        structuredContent: callResult,
      },
    });
  }

  private sendUnauthorized(res: ServerResponse): void {
    jsonResponse(
      res,
      401,
      { error: "Missing or invalid bearer token" },
      {
        "WWW-Authenticate": `Bearer resource_metadata="${this.config.publicBaseUrl}/.well-known/oauth-protected-resource"`,
      },
    );
  }
}
