import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { corsHeaders, isOriginAllowed } from "./http-security.js";

interface HttpErrorResponse {
  statusCode: number;
  payload: Record<string, unknown>;
}

export interface HttpServerRouterOptions {
  endpoint: string;
  legacySseEndpoint: string;
  legacyMessageEndpoint: string;
  healthEndpoint: string;
  oauthProtectedResourceEndpoint: string;
  allowedOrigins: string[];
  enableLegacySse: boolean;
  attachCurrentRateLimitHeaders(res: ServerResponse): void;
  handleRemoteHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean>;
  protectedResourceMetadata(req: IncomingMessage): Record<string, unknown>;
  rejectIfUnauthorized(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  readJsonBody(req: IncomingMessage): Promise<unknown>;
  handleStreamableRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void>;
  handleLegacySseConnection(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleLegacyMessage(req: IncomingMessage, res: ServerResponse): Promise<void>;
  errorResponse(error: unknown): HttpErrorResponse;
  onError(error: unknown): void;
  sendJson(
    req: IncomingMessage,
    res: ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>,
  ): void;
}

export function createHttpRequestHandler(options: HttpServerRouterOptions) {
  function handlePublicHttpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): boolean {
    if (pathname === options.oauthProtectedResourceEndpoint && req.method === "GET") {
      options.sendJson(req, res, 200, options.protectedResourceMetadata(req));
      return true;
    }
    if (pathname === options.healthEndpoint && req.method === "GET") {
      options.sendJson(req, res, 200, {
        ok: true,
        service: "ssh-mcp-pro",
        transport: "streamable-http",
      });
      return true;
    }
    return false;
  }

  function handleCorsPreflight(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): boolean {
    if (pathname !== options.endpoint || req.method !== "OPTIONS") {
      return false;
    }
    if (!isOriginAllowed(req.headers.origin, options.allowedOrigins)) {
      options.sendJson(req, res, 403, { error: "Origin is not allowed" });
      return true;
    }
    res.writeHead(204, corsHeaders(req.headers.origin, options.allowedOrigins));
    res.end();
    return true;
  }

  async function handleMcpHttpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (pathname !== options.endpoint) {
      return false;
    }
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
      options.sendJson(req, res, 405, { error: "Method not allowed" });
      return true;
    }
    const parsedBody = req.method === "POST" ? await options.readJsonBody(req) : undefined;
    await options.handleStreamableRequest(req, res, parsedBody);
    return true;
  }

  async function handleLegacySseRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (!options.enableLegacySse || pathname !== options.legacySseEndpoint) {
      return false;
    }
    if (req.method !== "GET") {
      options.sendJson(req, res, 405, { error: "Method not allowed" });
      return true;
    }
    await options.handleLegacySseConnection(req, res);
    return true;
  }

  async function handleLegacyMessageRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (!options.enableLegacySse || pathname !== options.legacyMessageEndpoint) {
      return false;
    }
    if (req.method !== "POST") {
      options.sendJson(req, res, 405, { error: "Method not allowed" });
      return true;
    }
    await options.handleLegacyMessage(req, res);
    return true;
  }

  async function handleAuthenticatedHttpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (await handleMcpHttpRoute(req, res, pathname)) {
      return true;
    }
    if (await handleLegacySseRoute(req, res, pathname)) {
      return true;
    }
    return handleLegacyMessageRoute(req, res, pathname);
  }

  function handleHttpRequestFailure(
    req: IncomingMessage,
    res: ServerResponse,
    error: unknown,
  ): void {
    options.onError(error);
    if (res.headersSent) {
      return;
    }
    const response = options.errorResponse(error);
    options.sendJson(req, res, response.statusCode, response.payload);
  }

  return async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const requestUrl = new URL(req.url ?? options.endpoint, "http://localhost");
      options.attachCurrentRateLimitHeaders(res);
      if (await options.handleRemoteHttpRequest(req, res, requestUrl.pathname)) {
        return;
      }
      if (handlePublicHttpRoute(req, res, requestUrl.pathname)) {
        return;
      }
      if (handleCorsPreflight(req, res, requestUrl.pathname)) {
        return;
      }
      if (await options.rejectIfUnauthorized(req, res)) {
        return;
      }
      if (await handleAuthenticatedHttpRoute(req, res, requestUrl.pathname)) {
        return;
      }
      options.sendJson(req, res, 404, { error: "Not found" });
    } catch (error) {
      handleHttpRequestFailure(req, res, error);
    }
  };
}
