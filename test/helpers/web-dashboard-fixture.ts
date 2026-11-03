import type { IncomingMessage } from "node:http";
import path from "node:path";
import { loadRemoteConfig } from "../../src/remote/config.js";
import type { RemoteConfig } from "../../src/remote/types.js";

export function testConfig(dir: string): RemoteConfig {
  const base = loadRemoteConfig();
  return {
    ...base,
    enabled: true,
    publicBaseUrl: "http://127.0.0.1:3000",
    mcpResourceUrl: "http://127.0.0.1:3000/mcp",
    databaseUrl: `file:${path.join(dir, "test.db")}`,
    controlPlaneSigningKeyPath: path.join(dir, "cp-key.json"),
    jwtSigningKeyPath: path.join(dir, "jwt-key.json"),
    allowAllUsers: true,
    githubClientId: "test-gh-client",
    githubClientSecret: "test-gh-secret",
    googleClientId: "test-google-client",
    googleClientSecret: "test-google-secret",
  };
}

export function request(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    method,
    url,
    headers: { host: "127.0.0.1:3000", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

export function jsonRequest(
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const payload = JSON.stringify(body);
  const req = request(method, url, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
    ...headers,
  }) as unknown as { [Symbol.asyncIterator](): AsyncIterableIterator<Buffer> };
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(payload);
  };
  return req as unknown as IncomingMessage;
}

export function captureResponse() {
  const headers = new Map<string, string | string[]>();
  let body = "";
  return {
    statusCode: 200,
    headers,
    setHeader(name: string, value: string | string[]) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(statusCode: number, customHeaders: Record<string, string> = {}) {
      this.statusCode = statusCode;
      for (const [k, v] of Object.entries(customHeaders)) {
        headers.set(k.toLowerCase(), v);
      }
    },
    end(chunk?: string) {
      if (chunk) {
        body += chunk;
      }
    },
    get body() {
      return body;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}
