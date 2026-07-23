import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { createConnection, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createContainer, type AppContainer } from "../../src/container.js";
import { DEFAULT_CONFIG, type ServerConfig } from "../../src/config.js";
import {
  createHttpServerRuntime,
  startHttpServer,
  type HttpServerRuntime,
  type HttpServerRuntimeOptions,
} from "../../src/server-http.js";
import { loadRemoteConfig } from "../../src/remote/config.js";
import type { RemoteConfig } from "../../src/remote/types.js";

const allowedOrigin = "https://client.example";
const bearerToken = "test-boundary-bearer-token";

interface Harness {
  baseUrl: string;
  container: AppContainer;
  dir: string;
  runtime: HttpServerRuntime;
  setNow(value: number): void;
}

const activeHarnesses = new Set<Harness>();

function completeHttpConfig(
  tokenFile: string | undefined,
  overrides: Partial<ServerConfig["http"]> = {},
): ServerConfig["http"] {
  return {
    ...DEFAULT_CONFIG.http,
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [allowedOrigin],
    ...(tokenFile ? { bearerTokenFile: tokenFile } : {}),
    enableLegacySse: false,
    maxRequestBodyBytes: 1024,
    maxSessions: 2,
    sessionIdleTtlMs: 60_000,
    trustProxy: false,
    ...overrides,
  };
}

function completeAuthConfig(overrides: Partial<ServerConfig["auth"]> = {}): ServerConfig["auth"] {
  return {
    ...DEFAULT_CONFIG.auth,
    mode: "bearer",
    oauthRequiredScopes: [...DEFAULT_CONFIG.auth.oauthRequiredScopes],
    oauthAllowedAlgorithms: [...DEFAULT_CONFIG.auth.oauthAllowedAlgorithms],
    ...overrides,
  };
}

async function startHarness(
  options: {
    auth?: Partial<ServerConfig["auth"]>;
    http?: Partial<ServerConfig["http"]>;
    now?: number;
    token?: string | null;
    remoteConfig?: RemoteConfig;
    remoteControlPlaneFactory?: HttpServerRuntimeOptions["remoteControlPlaneFactory"];
  } = {},
): Promise<Harness> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-http-boundary-"));
  const tokenFile = options.token === null ? undefined : path.join(dir, "bearer-token");
  if (tokenFile) {
    writeFileSync(tokenFile, options.token ?? bearerToken, { encoding: "utf8", mode: 0o600 });
  }
  let now = options.now ?? Date.UTC(2026, 6, 23, 12, 0, 0);
  const container = createContainer({
    http: completeHttpConfig(tokenFile, options.http),
    auth: completeAuthConfig(options.auth),
  });

  try {
    const runtime = await startHttpServer({
      container,
      now: () => now,
      remoteConfig: options.remoteConfig ?? { ...loadRemoteConfig(), enabled: false },
      registerSignalHandlers: false,
      ...(options.remoteControlPlaneFactory
        ? { remoteControlPlaneFactory: options.remoteControlPlaneFactory }
        : {}),
    });
    const address = runtime.server.address();
    if (!address || typeof address !== "object") {
      throw new Error("HTTP boundary harness did not expose a listening address");
    }
    const harness: Harness = {
      baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
      container,
      dir,
      runtime,
      setNow(value: number) {
        now = value;
      },
    };
    activeHarnesses.add(harness);
    return harness;
  } catch (error) {
    container.rateLimiter.destroy();
    await container.sessionManager.destroy();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function closeHarness(harness: Harness): Promise<void> {
  activeHarnesses.delete(harness);
  await harness.runtime.close("test-cleanup");
  rmSync(harness.dir, { recursive: true, force: true });
}

function authorizedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
    Origin: allowedOrigin,
    ...extra,
  };
}

async function initializeSession(harness: Harness): Promise<string> {
  const response = await fetch(`${harness.baseUrl}/mcp`, {
    method: "POST",
    headers: authorizedHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "http-boundary-test", version: "1.0.0" },
      },
    }),
  });
  expect(response.status).toBe(200);
  await response.text();
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  return sessionId ?? "";
}

async function pingSession(harness: Harness, sessionId: string): Promise<Response> {
  return fetch(`${harness.baseUrl}/mcp`, {
    method: "POST",
    headers: authorizedHeaders({ "MCP-Session-Id": sessionId }),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
  });
}

async function openLegacySse(harness: Harness): Promise<{
  response: IncomingMessage;
  sessionId: string;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${harness.baseUrl}/sse`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${bearerToken}`,
        Origin: allowedOrigin,
      },
    });
    request.once("error", reject);
    request.once("response", (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        const match = body.match(/sessionId=([^&\s]+)/u);
        if (match?.[1]) {
          resolve({ response, sessionId: decodeURIComponent(match[1]) });
        }
      });
      response.once("error", reject);
    });
    request.end();
  });
}

async function sendUpgrade(baseUrl: string, pathname: string): Promise<string> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = createConnection(Number(url.port), url.hostname);
    let received = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });
    socket.on("data", (chunk: string) => {
      received += chunk;
    });
    socket.once("end", () => resolve(received));
    socket.once("close", () => resolve(received));
    socket.once("error", reject);
  });
}

afterEach(async () => {
  await Promise.all([...activeHarnesses].map(closeHarness));
});

describe("real HTTP server boundary", () => {
  test("enforces bearer authorization and origin allowlists before MCP dispatch", async () => {
    const harness = await startHarness();

    const missing = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: allowedOrigin },
      body: "{}",
    });
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toMatchObject({
      error: "Missing or invalid bearer token",
    });

    const invalid = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token",
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      body: "{}",
    });
    expect(invalid.status).toBe(401);

    const disallowedOrigin = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: authorizedHeaders({ Origin: "https://attacker.example" }),
      body: "{}",
    });
    expect(disallowedOrigin.status).toBe(403);
    await expect(disallowedOrigin.json()).resolves.toMatchObject({
      error: "Origin is not allowed",
    });
  });

  test("returns OAuth challenges without contacting an external JWKS endpoint", async () => {
    const harness = await startHarness({
      auth: {
        mode: "oauth",
        oauthIssuer: "https://issuer.invalid",
        oauthJwksUrl: "https://issuer.invalid/jwks.json",
        oauthResource: "https://resource.example/mcp",
      },
    });

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: allowedOrigin },
      body: "{}",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    await expect(response.json()).resolves.toMatchObject({
      error: "Missing or invalid OAuth bearer token",
    });
  });

  test("handles CORS preflight and exposes current rate-limit headers", async () => {
    const harness = await startHarness();

    const allowed = await fetch(`${harness.baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: allowedOrigin },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(allowedOrigin);

    const denied = await fetch(`${harness.baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });
    expect(denied.status).toBe(403);

    const health = await fetch(`${harness.baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(health.headers.get("x-ratelimit-limit")).toBeTruthy();
    await expect(health.json()).resolves.toMatchObject({ ok: true, transport: "streamable-http" });
  });

  test("initializes a real MCP session and expires it using the injected clock", async () => {
    const startTime = Date.UTC(2026, 6, 23, 12, 0, 0);
    const harness = await startHarness({ now: startTime, http: { sessionIdleTtlMs: 1_000 } });
    const sessionId = await initializeSession(harness);

    const active = await pingSession(harness, sessionId);
    expect(active.status).toBe(200);
    await active.text();

    harness.setNow(startTime + 1_001);
    const expired = await pingSession(harness, sessionId);
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining("valid MCP-Session-Id") }),
    });
  });

  test("enforces session capacity at the network boundary", async () => {
    const harness = await startHarness({ http: { maxSessions: 0 } });
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "capacity-test", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "HTTP MCP session limit reached",
      maxSessions: 0,
    });
  });

  test("rejects oversized request bodies before MCP dispatch", async () => {
    const harness = await startHarness({ http: { maxRequestBodyBytes: 64 } });
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: JSON.stringify({ payload: "x".repeat(256) }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Request body is too large" });
  });

  test("cleans container resources when bearer-token loading fails before bind", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-http-token-failure-"));
    const missingTokenFile = path.join(dir, "missing-token");
    const container = createContainer({
      http: completeHttpConfig(missingTokenFile),
    });
    const rateLimiterDestroy = vi.spyOn(container.rateLimiter, "destroy");
    const sessionManagerDestroy = vi.spyOn(container.sessionManager, "destroy");
    const runtime = createHttpServerRuntime({
      container,
      remoteConfig: { ...loadRemoteConfig(), enabled: false },
      registerSignalHandlers: false,
    });

    await expect(runtime.start()).rejects.toMatchObject({ code: "ENOENT" });
    expect(runtime.server.listening).toBe(false);
    expect(rateLimiterDestroy).toHaveBeenCalledTimes(1);
    expect(sessionManagerDestroy).toHaveBeenCalledTimes(1);
    await runtime.close("post-failure-close");
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects an empty bearer-token file through the real startup path", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-http-empty-token-"));
    const tokenFile = path.join(dir, "empty-token");
    writeFileSync(tokenFile, "  \n", { encoding: "utf8", mode: 0o600 });
    const container = createContainer({
      http: completeHttpConfig(tokenFile),
    });

    await expect(
      startHttpServer({
        container,
        remoteConfig: { ...loadRemoteConfig(), enabled: false },
        registerSignalHandlers: false,
      }),
    ).rejects.toThrow("empty bearer token file");
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects unsafe non-loopback startup before binding a public interface", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-http-startup-"));
    const tokenFile = path.join(dir, "bearer-token");
    writeFileSync(tokenFile, bearerToken, { encoding: "utf8", mode: 0o600 });
    const container = createContainer({
      http: completeHttpConfig(tokenFile, {
        host: "0.0.0.0",
        allowedOrigins: [],
        publicUrl: undefined,
      }),
    });

    await expect(
      startHttpServer({
        container,
        remoteConfig: { ...loadRemoteConfig(), enabled: false },
        registerSignalHandlers: false,
      }),
    ).rejects.toThrow("Refusing non-loopback HTTP MCP binding");
    expect(createHttpServerRuntime).toBeTypeOf("function");
    rmSync(dir, { recursive: true, force: true });
  });

  test("serves protected-resource metadata with configured and forwarded public URLs", async () => {
    const configured = await startHarness({
      http: { publicUrl: "https://public.example/base" },
    });
    const configuredResponse = await fetch(
      `${configured.baseUrl}/.well-known/oauth-protected-resource`,
    );
    expect(configuredResponse.status).toBe(200);
    await expect(configuredResponse.json()).resolves.toMatchObject({
      resource: "https://public.example/base/mcp",
      resource_name: "ssh-mcp-pro",
    });
    await closeHarness(configured);

    const forwarded = await startHarness({
      token: null,
      http: { trustProxy: true },
    });
    const forwardedResponse = await fetch(
      `${forwarded.baseUrl}/.well-known/oauth-protected-resource`,
      { headers: { "X-Forwarded-Proto": "https" } },
    );
    expect(forwardedResponse.status).toBe(200);
    const forwardedBody = (await forwardedResponse.json()) as { resource: string };
    expect(forwardedBody.resource).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/mcp$/u);
  });

  test("handles open loopback mode, method rejection, not-found, empty, and malformed bodies", async () => {
    const harness = await startHarness({ token: null });

    const empty = await fetch(`${harness.baseUrl}/mcp`, { method: "POST" });
    expect(empty.status).toBe(400);

    const method = await fetch(`${harness.baseUrl}/mcp`, { method: "PUT" });
    expect(method.status).toBe(405);
    await expect(method.json()).resolves.toEqual({ error: "Method not allowed" });

    const missing = await fetch(`${harness.baseUrl}/missing`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "Not found" });

    const malformed = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(malformed.status).toBe(500);
    await expect(malformed.json()).resolves.toEqual({ error: "Internal server error" });
  });

  test("evicts the oldest live session and closes a replacement session", async () => {
    const harness = await startHarness({ http: { maxSessions: 1 } });
    const first = await initializeSession(harness);
    const second = await initializeSession(harness);
    expect(harness.runtime.sessionCount).toBe(1);

    const evicted = await pingSession(harness, first);
    expect(evicted.status).toBe(400);

    const active = await pingSession(harness, second);
    expect(active.status).toBe(200);
    await active.text();

    const deleted = await fetch(`${harness.baseUrl}/mcp`, {
      method: "DELETE",
      headers: authorizedHeaders({ "MCP-Session-Id": second }),
    });
    expect(deleted.status).toBeLessThan(300);
    await deleted.text();
    expect(harness.runtime.sessionCount).toBe(0);
  });

  test("covers legacy SSE route boundaries and transport mismatch handling", async () => {
    const full = await startHarness({ http: { enableLegacySse: true, maxSessions: 0 } });
    const atCapacity = await fetch(`${full.baseUrl}/sse`, {
      headers: { Authorization: `Bearer ${bearerToken}`, Origin: allowedOrigin },
    });
    expect(atCapacity.status).toBe(503);
    await closeHarness(full);

    const harness = await startHarness({ http: { enableLegacySse: true } });
    const wrongSseMethod = await fetch(`${harness.baseUrl}/sse`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: "{}",
    });
    expect(wrongSseMethod.status).toBe(405);

    const wrongMessageMethod = await fetch(`${harness.baseUrl}/messages`, {
      headers: authorizedHeaders(),
    });
    expect(wrongMessageMethod.status).toBe(405);

    const missingSession = await fetch(`${harness.baseUrl}/messages`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: "{}",
    });
    expect(missingSession.status).toBe(400);

    const unknownSession = await fetch(`${harness.baseUrl}/messages?sessionId=missing`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: "{}",
    });
    expect(unknownSession.status).toBe(404);

    const legacy = await openLegacySse(harness);
    expect(harness.runtime.sessionCount).toBe(1);
    const mismatch = await pingSession(harness, legacy.sessionId);
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toEqual({
      error: "Session exists but uses a different transport protocol",
    });

    const legacyMessage = await fetch(
      `${harness.baseUrl}/messages?sessionId=${encodeURIComponent(legacy.sessionId)}`,
      {
        method: "POST",
        headers: authorizedHeaders(),
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
      },
    );
    expect(legacyMessage.status).toBeLessThan(500);
    await legacyMessage.text();
    legacy.response.destroy();
  });

  test("delegates HTTP and WebSocket boundaries to an enabled remote control plane", async () => {
    const close = vi.fn();
    const handleHttp = vi.fn(
      async (_req: IncomingMessage, res: import("node:http").ServerResponse, pathname: string) => {
        if (pathname === "/remote-handled") {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ handled: true }));
          return true;
        }
        if (pathname === "/remote-error") {
          throw { status: 418, message: "Remote boundary rejected", code: "REMOTE_REJECTED" };
        }
        return false;
      },
    );
    const handleUpgrade = vi.fn(
      (
        _req: IncomingMessage,
        socket: import("node:stream").Duplex,
        _head: Buffer,
        pathname: string,
      ) => {
        if (pathname === "/remote-ws") {
          socket.end(
            "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
          );
          return true;
        }
        return false;
      },
    );
    const remote = { handleHttp, handleUpgrade, close };
    const remoteConfig = { ...loadRemoteConfig(), enabled: true };
    const harness = await startHarness({
      remoteConfig,
      remoteControlPlaneFactory: (() => Promise.resolve(remote)) as never,
    });

    const handled = await fetch(`${harness.baseUrl}/remote-handled`);
    expect(handled.status).toBe(202);
    await expect(handled.json()).resolves.toEqual({ handled: true });

    const fallback = await fetch(`${harness.baseUrl}/healthz`);
    expect(fallback.status).toBe(200);

    const rejected = await fetch(`${harness.baseUrl}/remote-error`);
    expect(rejected.status).toBe(418);
    await expect(rejected.json()).resolves.toEqual({
      error: "Remote boundary rejected",
      code: "REMOTE_REJECTED",
    });

    const acceptedUpgrade = await sendUpgrade(harness.baseUrl, "/remote-ws");
    expect(acceptedUpgrade).toContain("101 Switching Protocols");
    const rejectedUpgrade = await sendUpgrade(harness.baseUrl, "/unknown-ws");
    expect(rejectedUpgrade).toBe("");

    await closeHarness(harness);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("shuts down idempotently and stops accepting connections", async () => {
    const harness = await startHarness();
    expect(harness.runtime.server.listening).toBe(true);

    await harness.runtime.close("test-shutdown");
    await harness.runtime.close("test-shutdown-again");
    activeHarnesses.delete(harness);

    expect(harness.runtime.server.listening).toBe(false);
    await expect(fetch(`${harness.baseUrl}/healthz`)).rejects.toThrow();
    rmSync(harness.dir, { recursive: true, force: true });
  });
});
