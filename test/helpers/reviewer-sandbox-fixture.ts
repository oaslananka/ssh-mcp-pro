import { createHash, randomBytes, scryptSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { randomToken } from "../../src/remote/crypto.js";
import { captureResponse, jsonRequest, request, testConfig } from "./web-dashboard-fixture.js";
import { writeTestHttpError } from "./http-error.js";

export const REVIEWER_USERNAME = "openai-reviewer";
export const REVIEWER_PASSWORD = randomToken(24);
export const PUBLIC_BASE_URL = "http://127.0.0.1:3000";

export function reviewerPasswordHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export const jsonBodyRequest = jsonRequest;

export function formRequest(
  method: string,
  url: string,
  values: Record<string, string>,
  headers: Record<string, string> = {},
): IncomingMessage {
  const body = new URLSearchParams(values).toString();
  const fixture = request(method, url, {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": String(Buffer.byteLength(body)),
    ...headers,
  });
  const stream = Readable.from([Buffer.from(body)]) as IncomingMessage;
  stream.method = fixture.method;
  stream.url = fixture.url;
  stream.headers = fixture.headers;
  stream.socket = fixture.socket;
  return stream;
}

export async function dispatch(
  controlPlane: RemoteControlPlane,
  incoming: IncomingMessage,
  pathname: string,
) {
  const response = captureResponse();
  let handled = false;
  try {
    handled = await controlPlane.handleHttp(
      incoming,
      response as unknown as ServerResponse,
      pathname,
    );
  } catch (error) {
    writeTestHttpError(response as unknown as ServerResponse, error);
    handled = true;
  }
  return { handled, response };
}

export function setCookie(
  response: ReturnType<typeof captureResponse>,
  name: string,
): string | undefined {
  const header = response.getHeader("set-cookie");
  const lines = Array.isArray(header) ? header : header ? [header] : [];
  const prefix = `${name}=`;
  const line = lines.find((value) => value.startsWith(prefix));
  return line?.split(";")[0];
}

export function csrfFromPage(html: string): string {
  const value = /name="csrf" value="([A-Za-z0-9_-]{43})"/u.exec(html)?.[1];
  if (!value) throw new Error("Reviewer page did not contain a CSRF token");
  return value;
}

export function createControlPlane(dir: string, enabled = true): RemoteControlPlane {
  const base = testConfig(dir);
  return new RemoteControlPlane({
    ...base,
    githubClientId: undefined,
    githubClientSecret: undefined,
    googleClientId: undefined,
    googleClientSecret: undefined,
    reviewerUsername: enabled ? REVIEWER_USERNAME : undefined,
    reviewerPasswordHash: enabled ? reviewerPasswordHash(REVIEWER_PASSWORD) : undefined,
  });
}

export async function reviewerLoginPage(controlPlane: RemoteControlPlane) {
  return dispatch(controlPlane, request("GET", "/oauth/reviewer/login"), "/oauth/reviewer/login");
}

export async function login(
  controlPlane: RemoteControlPlane,
  username = REVIEWER_USERNAME,
  password = REVIEWER_PASSWORD,
) {
  const page = await reviewerLoginPage(controlPlane);
  const csrf = csrfFromPage(page.response.body);
  const csrfCookie = setCookie(page.response, "ssh_mcp_reviewer_csrf");
  if (!csrfCookie) throw new Error("Reviewer login did not set its CSRF cookie");
  return dispatch(
    controlPlane,
    formRequest(
      "POST",
      "/oauth/reviewer/login",
      { csrf, username, password },
      { origin: PUBLIC_BASE_URL, cookie: csrfCookie },
    ),
    "/oauth/reviewer/login",
  );
}

export function authorizationUrl(clientId: string, redirectUri: string, scope: string): string {
  const url = new URL("/oauth/authorize", PUBLIC_BASE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update("reviewer-pkce-verifier").digest("base64url"),
  );
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", `${PUBLIC_BASE_URL}/mcp`);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", "reviewer-state");
  return `${url.pathname}${url.search}`;
}
