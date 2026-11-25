import type { ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import { RemoteMcpRequestHandler } from "../../src/remote/control-plane-mcp.js";
import { captureResponse, request, testConfig } from "../helpers/web-dashboard-fixture.js";

describe("remote MCP request boundary", () => {
  test("does not authenticate preflight or dispatch unauthenticated requests", async () => {
    const authenticate = vi.fn(async () => {
      throw new Error("Unauthorized");
    });
    const callRemoteTool = vi.fn(async () => {
      throw new Error("Unexpected dispatch");
    });
    const config = testConfig(".");
    const handler = new RemoteMcpRequestHandler(config, authenticate, callRemoteTool);
    const options = captureResponse();
    await handler.handleMcp(request("OPTIONS", "/mcp"), options as unknown as ServerResponse);
    expect(options.statusCode).toBe(204);
    expect(authenticate).not.toHaveBeenCalled();
    const get = captureResponse();
    await handler.handleMcp(request("GET", "/mcp"), get as unknown as ServerResponse);
    expect(get.statusCode).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    const post = captureResponse();
    await handler.handleMcp(request("POST", "/mcp"), post as unknown as ServerResponse);
    expect(post.statusCode).toBe(401);
    expect(post.getHeader("www-authenticate")).toBe(
      'Bearer resource_metadata="' +
        config.publicBaseUrl +
        '/.well-known/oauth-protected-resource"',
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(callRemoteTool).not.toHaveBeenCalled();
  });
});
