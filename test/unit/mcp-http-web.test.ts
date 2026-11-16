import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { toMcpWebRequest, sendMcpWebResponse } from "../../src/mcp-http-web.js";

describe("mcp-http-web", () => {
  it("converts incoming message with string and array headers to web request", () => {
    const req = {
      headers: {
        "content-type": "application/json",
        accept: ["application/json", "text/plain"],
        ignored: undefined as unknown as string,
      },
      url: "/custom-mcp",
      method: "POST",
    } as unknown as IncomingMessage;

    const webReq = toMcpWebRequest(req, { jsonrpc: "2.0" });
    expect(webReq.url).toBe("http://localhost/custom-mcp");
    expect(webReq.method).toBe("POST");
    expect(webReq.headers.get("content-type")).toBe("application/json");
    expect(webReq.headers.get("accept")).toBe("application/json, text/plain");
  });

  it("handles missing url, method, and non-POST body in toMcpWebRequest", () => {
    const req = {
      headers: {},
    } as unknown as IncomingMessage;

    const webReq = toMcpWebRequest(req);
    expect(webReq.url).toBe("http://localhost/mcp");
    expect(webReq.method).toBe("POST");

    const getReq = {
      headers: {},
      url: "/mcp",
      method: "GET",
    } as unknown as IncomingMessage;
    const webGet = toMcpWebRequest(getReq, { unused: true });
    expect(webGet.method).toBe("GET");
  });

  it("sends web response without body", async () => {
    let ended = false;
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      end: () => {
        ended = true;
      },
    } as unknown as ServerResponse;

    const response = new Response(null, {
      status: 204,
      headers: { "x-test": "1" },
    });

    await sendMcpWebResponse(res, response);
    expect(res.statusCode).toBe(204);
    expect(headers["x-test"]).toBe("1");
    expect(ended).toBe(true);
  });
});
