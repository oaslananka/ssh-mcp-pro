import { randomUUID } from "node:crypto";
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { isBearerAuthorizationValid } from "./auth.js";
import { createContainer, type AppContainer } from "./container.js";
import { SERVER_VERSION, SSHMCPServer } from "./mcp.js";
import { logger } from "./logging.js";
import { isOAuthAuthorizationValid, type OAuthVerificationConfig } from "./oauth.js";
import { initTelemetry, shutdownTelemetry, withSpan } from "./telemetry.js";
import {
  corsHeaders,
  isLoopbackHost,
  isOriginAllowed,
  oauthProtectedResourceMetadataUrl,
  oauthWwwAuthenticateHeader,
  validateHttpStartupConfig,
} from "./http-security.js";
import { attachRateLimitHeaders, buildRateLimitHeaders } from "./http-rate-limit.js";
import { createRemoteControlPlane } from "./remote/control-plane.js";
import { loadRemoteConfig } from "./remote/config.js";
import type { RemoteConfig } from "./remote/types.js";
import { userSafeError } from "./remote/util.js";
import { createHttpServerLifecycle } from "./http-server-lifecycle.js";
import { createHttpRequestHandler } from "./http-server-router.js";
import { HttpSessionRegistry } from "./http-session-registry.js";

type HttpTransport = StreamableHTTPServerTransport | SSEServerTransport;

interface HttpSession {
  server: SSHMCPServer;
  transport: HttpTransport;
  lastSeenAt: number;
}

const endpoint = "/mcp";
const legacySseEndpoint = "/sse";
const legacyMessageEndpoint = "/messages";
const healthEndpoint = "/healthz";
const oauthProtectedResourceEndpoint = "/.well-known/oauth-protected-resource";
export interface HttpServerRuntimeOptions {
  container?: AppContainer;
  remoteConfig?: RemoteConfig;
  now?: () => number;
  registerSignalHandlers?: boolean;
  exitOnSignal?: boolean;
  remoteControlPlaneFactory?: typeof createRemoteControlPlane;
}

export interface HttpServerRuntime {
  readonly server: Server;
  readonly sessionCount: number;
  start(): Promise<void>;
  close(reason?: string): Promise<void>;
}

export function createHttpServerRuntime(options: HttpServerRuntimeOptions = {}): HttpServerRuntime {
  const container = options.container ?? createContainer();
  const httpConfig = container.config.get("http");
  const authConfig = container.config.get("auth");
  const connectorConfig = container.config.get("connector");
  const policyConfig = container.config.get("policy");
  const remoteConfig = options.remoteConfig ?? loadRemoteConfig();
  const now = options.now ?? Date.now;
  const remoteControlPlaneFactory = options.remoteControlPlaneFactory ?? createRemoteControlPlane;
  let remoteControlPlanePromise: ReturnType<typeof createRemoteControlPlane> | undefined;
  let cleanupInterval: NodeJS.Timeout | undefined;

  const sessions = new HttpSessionRegistry<HttpSession>({
    maxSessions: httpConfig.maxSessions,
    sessionIdleTtlMs: httpConfig.sessionIdleTtlMs,
    now,
    onClose: (sessionId, session, reason) => {
      logger.info("HTTP MCP session removed", { sessionId, reason });
      void session.transport.close().catch((error) => {
        logger.warn("Failed to close HTTP MCP transport cleanly", { sessionId, error });
      });
    },
  });
  let bearerToken: string | undefined;

  class RequestBodyTooLargeError extends Error {
    constructor() {
      super("Request body is too large");
    }
  }

  function sendJson(
    req: IncomingMessage,
    res: ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      ...corsHeaders(req.headers.origin, httpConfig.allowedOrigins),
      ...extraHeaders,
    });
    res.end(JSON.stringify(payload, null, 2));
  }

  function configuredPublicMcpUrl(): string | undefined {
    if (!httpConfig.publicUrl) {
      return undefined;
    }

    const url = new URL(httpConfig.publicUrl);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = endpoint;
    } else if (!url.pathname.endsWith(endpoint)) {
      url.pathname = `${url.pathname.replace(/\/$/u, "")}${endpoint}`;
    }
    return url.toString();
  }

  function requestProtocol(req: IncomingMessage): "http" | "https" {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const rawProtocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    if (httpConfig.trustProxy && (rawProtocol === "http" || rawProtocol === "https")) {
      return rawProtocol;
    }
    return isLoopbackHost(httpConfig.host) ? "http" : "https";
  }

  function buildPublicMcpUrl(req: IncomingMessage): string {
    const configured = configuredPublicMcpUrl();
    if (configured) {
      return configured;
    }

    const protocol = requestProtocol(req);
    const authority = req.headers.host ?? `localhost:${httpConfig.port}`;
    return `${protocol}://${authority}${endpoint}`;
  }

  function removeHttpSession(sessionId: string, reason: string): void {
    if (sessions.delete(sessionId)) {
      logger.info("HTTP MCP session removed", { sessionId, reason });
    }
  }

  function cleanupExpiredHttpSessions(): void {
    sessions.cleanupExpired();
  }

  function getHttpSession(sessionId: string | undefined): HttpSession | undefined {
    return sessions.getActive(sessionId);
  }

  function canOpenHttpSession(req: IncomingMessage, res: ServerResponse): boolean {
    const capacity = sessions.reserveCapacity();
    if (capacity.allowed) {
      if (capacity.reason === "capacity-evict-oldest") {
        logger.warn("HTTP MCP session limit reached; evicted oldest session", {
          evictedSessionId: capacity.evictedSessionId,
          maxSessions: httpConfig.maxSessions,
          remainingSessions: sessions.size,
        });
      }
      return true;
    }

    sendJson(req, res, 503, {
      error: "HTTP MCP session limit reached",
      maxSessions: httpConfig.maxSessions,
    });
    return false;
  }

  function protectedResourceMetadata(req: IncomingMessage): Record<string, unknown> {
    return {
      resource: authConfig.oauthResource ?? buildPublicMcpUrl(req),
      resource_name: "ssh-mcp-pro",
      bearer_methods_supported: ["header"],
      scopes_supported: authConfig.oauthRequiredScopes,
      authorization_servers: authConfig.oauthIssuer ? [authConfig.oauthIssuer] : [],
    };
  }

  function attachCurrentRateLimitHeaders(res: ServerResponse): void {
    attachRateLimitHeaders(res, () =>
      buildRateLimitHeaders(container.rateLimiter, container.config.get("rateLimit")),
    );
  }

  function oauthChallengeHeader(req: IncomingMessage): string {
    return oauthWwwAuthenticateHeader(
      oauthProtectedResourceMetadataUrl(buildPublicMcpUrl(req)),
      authConfig.oauthRequiredScopes,
      req.headers.authorization !== undefined,
    );
  }

  async function rejectIfUnauthorized(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, httpConfig.allowedOrigins)) {
      sendJson(req, res, 403, { error: "Origin is not allowed" });
      return true;
    }

    if (authConfig.mode === "oauth") {
      const verificationConfig: OAuthVerificationConfig = {
        audience: authConfig.oauthAudience ?? authConfig.oauthResource ?? buildPublicMcpUrl(req),
        requiredScopes: authConfig.oauthRequiredScopes,
      };
      if (authConfig.oauthIssuer) {
        verificationConfig.issuer = authConfig.oauthIssuer;
      }
      if (authConfig.oauthJwksUrl) {
        verificationConfig.jwksUrl = authConfig.oauthJwksUrl;
      }
      if (authConfig.oauthAllowedAlgorithms.length > 0) {
        verificationConfig.allowedAlgorithms = authConfig.oauthAllowedAlgorithms;
      }

      const valid = await isOAuthAuthorizationValid(req.headers.authorization, verificationConfig);
      if (!valid) {
        sendJson(
          req,
          res,
          401,
          { error: "Missing or invalid OAuth bearer token" },
          { "WWW-Authenticate": oauthChallengeHeader(req) },
        );
        return true;
      }
      return false;
    }

    if (!bearerToken) {
      return false;
    }

    if (!isBearerAuthorizationValid(req.headers.authorization, bearerToken)) {
      sendJson(req, res, 401, { error: "Missing or invalid bearer token" });
      return true;
    }

    return false;
  }

  async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > httpConfig.maxRequestBodyBytes) {
        throw new RequestBodyTooLargeError();
      }
      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      return undefined;
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : undefined;
  }

  async function handleStreamableRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    await withSpan(
      "http.streamable.request",
      async (span) => {
        const sessionHeader = req.headers["mcp-session-id"];
        const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
        cleanupExpiredHttpSessions();
        let session = getHttpSession(sessionId);

        span.setAttribute("http.route", endpoint);
        span.setAttribute("http.method", req.method ?? "UNKNOWN");
        if (sessionId) {
          span.setAttribute("mcp.session.id", sessionId);
        }

        if (!session && req.method === "POST" && isInitializeRequest(parsedBody)) {
          if (!canOpenHttpSession(req, res)) {
            return;
          }
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              sessions.set(newSessionId, { server, transport, lastSeenAt: now() });
              logger.info("Streamable HTTP MCP session initialized", { sessionId: newSessionId });
            },
          });
          const server = new SSHMCPServer(container);
          transport.onclose = () => {
            const closedSessionId = transport.sessionId;
            if (closedSessionId) {
              removeHttpSession(closedSessionId, "transport-closed");
            }
          };
          transport.onerror = (error) => {
            logger.error("Streamable HTTP MCP transport error", { error: error.message });
          };
          await server.connect(transport as Transport);
          session = { server, transport, lastSeenAt: now() };
        }

        if (!session) {
          sendJson(req, res, 400, {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: initialize with POST /mcp or provide a valid MCP-Session-Id",
            },
            id: null,
          });
          return;
        }

        if (!(session.transport instanceof StreamableHTTPServerTransport)) {
          sendJson(req, res, 400, {
            error: "Session exists but uses a different transport protocol",
          });
          return;
        }

        await session.transport.handleRequest(req, res, parsedBody);
      },
      {
        attributes: {
          "http.route": endpoint,
          "http.method": req.method ?? "UNKNOWN",
        },
      },
    );
  }

  async function handleLegacySseConnection(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!canOpenHttpSession(req, res)) {
      return;
    }
    const transport = new SSEServerTransport(legacyMessageEndpoint, res);
    const sessionId = transport.sessionId;
    const server = new SSHMCPServer(container);

    transport.onclose = () => {
      removeHttpSession(sessionId, "legacy-transport-closed");
    };
    sessions.set(sessionId, { server, transport, lastSeenAt: now() });
    await server.connect(transport);
    logger.warn("Legacy HTTP/SSE MCP session established", { sessionId });
  }

  async function handleLegacyMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const baseUrl = `http://${req.headers.host ?? "localhost"}`;
    const requestUrl = new URL(req.url ?? legacyMessageEndpoint, baseUrl);
    const sessionId = requestUrl.searchParams.get("sessionId");
    if (!sessionId) {
      sendJson(req, res, 400, { error: "Missing sessionId query parameter" });
      return;
    }

    const session = getHttpSession(sessionId);
    if (!session || !(session.transport instanceof SSEServerTransport)) {
      sendJson(req, res, 404, { error: "Legacy SSE session not found" });
      return;
    }

    await session.transport.handlePostMessage(req, res);
  }

  async function handleRemoteHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (!remoteControlPlanePromise) {
      return false;
    }
    const remoteControlPlane = await remoteControlPlanePromise;
    return remoteControlPlane.handleHttp(req, res, pathname);
  }

  function errorResponse(error: unknown): {
    statusCode: number;
    payload: Record<string, unknown>;
  } {
    if (error && typeof error === "object" && "status" in error && "message" in error) {
      const status = Number((error as { status: number }).status);
      const message = String((error as { message: string }).message);
      const code = "code" in error ? String((error as { code: string }).code) : undefined;
      return {
        statusCode: Number.isFinite(status) ? status : 500,
        payload: { error: message, code },
      };
    }
    if (error instanceof RequestBodyTooLargeError) {
      return { statusCode: 413, payload: { error: "Request body is too large" } };
    }
    return { statusCode: 500, payload: { error: "Internal server error" } };
  }

  const handleHttpRequest = createHttpRequestHandler({
    endpoint,
    legacySseEndpoint,
    legacyMessageEndpoint,
    healthEndpoint,
    oauthProtectedResourceEndpoint,
    allowedOrigins: httpConfig.allowedOrigins,
    enableLegacySse: httpConfig.enableLegacySse,
    attachCurrentRateLimitHeaders,
    handleRemoteHttpRequest,
    protectedResourceMetadata,
    rejectIfUnauthorized,
    readJsonBody,
    handleStreamableRequest,
    handleLegacySseConnection,
    handleLegacyMessage,
    errorResponse,
    onError: (error) => {
      logger.error("HTTP MCP request failed", { error: userSafeError(error) });
    },
    sendJson,
  });

  const httpServer = createNodeHttpServer((req, res) => {
    void handleHttpRequest(req, res);
  });

  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      try {
        const requestUrl = new URL(req.url ?? "/", "http://localhost");
        if (remoteControlPlanePromise) {
          const remoteControlPlane = await remoteControlPlanePromise;
          if (remoteControlPlane.handleUpgrade(req, socket, head, requestUrl.pathname)) {
            return;
          }
        }
        socket.destroy();
      } catch {
        socket.destroy();
      }
    })();
  });

  const lifecycle = createHttpServerLifecycle({
    server: httpServer,
    host: httpConfig.host,
    port: httpConfig.port,
    registerSignalHandlers: options.registerSignalHandlers,
    exitOnSignal: options.exitOnSignal,
    beforeListen: async () => {
      bearerToken = httpConfig.bearerTokenFile
        ? readFileSync(httpConfig.bearerTokenFile, "utf8").trim()
        : undefined;
      if (!remoteConfig.enabled) {
        validateHttpStartupConfig(httpConfig, bearerToken, {
          toolProfile: connectorConfig.toolProfile,
          allowedHosts: policyConfig.allowedHosts,
          hostKeyPolicy: container.config.get("security").hostKeyPolicy,
          authMode: authConfig.mode,
          oauthConfigured: Boolean(authConfig.oauthIssuer && authConfig.oauthJwksUrl),
        });
      } else {
        remoteControlPlanePromise = remoteControlPlaneFactory();
      }

      initTelemetry({ serviceVersion: SERVER_VERSION });
      cleanupInterval = setInterval(
        cleanupExpiredHttpSessions,
        Math.max(1000, Math.min(httpConfig.sessionIdleTtlMs, 60_000)),
      );
      cleanupInterval.unref?.();
    },
    afterListen: (listeningPort) => {
      logger.info("Streamable HTTP MCP server listening", {
        host: httpConfig.host,
        port: listeningPort,
        endpoint,
        legacySse: httpConfig.enableLegacySse,
      });
    },
    cleanup: async (reason) => {
      logger.info("Shutting down HTTP MCP server", { reason });
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = undefined;
      }

      await Promise.all(
        Array.from(sessions.entries()).map(async ([sessionId, session]) => {
          try {
            await session.transport.close();
          } catch (error) {
            logger.warn("Failed to close HTTP MCP transport cleanly", { sessionId, error });
          }
        }),
      );
      sessions.clear();
      container.rateLimiter.destroy();
      await container.sessionManager.destroy();
      if (remoteControlPlanePromise) {
        const remoteControlPlane = await remoteControlPlanePromise;
        remoteControlPlane.close();
      }
      await shutdownTelemetry();
    },
  });

  return {
    server: httpServer,
    get sessionCount() {
      return sessions.size;
    },
    start: lifecycle.start,
    close: lifecycle.close,
  };
}

export async function startHttpServer(
  options: HttpServerRuntimeOptions = {},
): Promise<HttpServerRuntime> {
  const runtime = createHttpServerRuntime(options);
  await runtime.start();
  return runtime;
}
