import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { escape as escapeHtml } from "html-escaper";
import { hashSecret, nowIso, randomToken } from "./crypto.js";
import { addNoStore, readJsonOrForm, safeError } from "./http-util.js";
import { isValidReviewerPasswordHash, verifyReviewerPassword } from "./reviewer-auth.js";
import { RemoteStore } from "./store.js";
import { REVIEWER_DEMO_USER_ID, type RemoteConfig } from "./types.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const CSRF_TTL_MS = 10 * 60 * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 5;
const MAX_TRACKED_TOKENS = 1_024;
const SESSION_COOKIE = "ssh_mcp_reviewer_session";
const CSRF_COOKIE = "ssh_mcp_reviewer_csrf";

interface ExpiringAttempt {
  count: number;
  expiresAt: number;
}

export class ReviewerSessionHandler {
  private readonly csrfTokens = new Map<string, number>();
  private readonly loginAttempts = new Map<string, ExpiringAttempt>();

  constructor(
    private readonly config: RemoteConfig,
    private readonly store: RemoteStore,
  ) {}

  isEnabled(): boolean {
    return Boolean(
      this.config.reviewerUsername &&
      this.config.reviewerUsername.length <= 128 &&
      isValidReviewerPasswordHash(this.config.reviewerPasswordHash),
    );
  }

  getUserId(req: IncomingMessage): string | undefined {
    if (!this.isEnabled()) return undefined;
    const token = this.cookieValue(req, SESSION_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return undefined;
    const session = this.store.getDashboardSession(hashSecret(token), nowIso());
    if (session?.userId !== REVIEWER_DEMO_USER_ID) return undefined;
    return this.store.getUserById(session.userId)?.provider === "demo" ? session.userId : undefined;
  }

  async handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.isEnabled()) {
      this.writeHtml(res, 404, this.unavailablePage());
      return;
    }
    if (req.method === "GET") {
      this.handleLoginPage(req, res);
      return;
    }
    await this.handleLoginSubmission(req, res);
  }

  private handleLoginPage(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/oauth/reviewer/login", this.config.publicBaseUrl);
    const returnTo = this.parseReturnTo(url.searchParams.get("return_to") ?? undefined);
    if (this.getUserId(req)) {
      if (returnTo) this.redirectTo(res, returnTo);
      else this.writeReadyPage(res);
    } else {
      this.writeLoginPage(res, 200, undefined, {}, returnTo);
    }
  }

  private async handleLoginSubmission(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") throw safeError("FORBIDDEN", "Method not allowed", 405);
    this.assertSameOrigin(req);
    this.assertFormRequest(req);
    const form = await readJsonOrForm(req);
    if (!this.consumeCsrfToken(req, form.csrf ?? "")) {
      throw safeError("FORBIDDEN", "Reviewer login request could not be verified", 403);
    }

    const returnToValue = form.return_to ?? "";
    const returnTo = this.parseReturnTo(returnToValue || undefined);
    if (returnToValue && !returnTo) {
      throw safeError("INVALID_CLIENT", "Reviewer return target is invalid", 400);
    }
    const username = form.username ?? "";
    const password = form.password ?? "";
    const attemptKey = this.loginAttemptKey(req, username);
    if (this.isRateLimited(attemptKey)) {
      this.writeLoginPage(
        res,
        429,
        "Too many sign-in attempts. Try again later.",
        { "Retry-After": String(LOGIN_WINDOW_MS / 1_000) },
        returnTo,
      );
      return;
    }
    // Usernames are identifiers, not passwords; password comparison uses scrypt below.
    const usernameMatches = username.trim() === this.config.reviewerUsername;
    const passwordMatches = await verifyReviewerPassword(
      password,
      this.config.reviewerPasswordHash ?? "",
    );
    if (!usernameMatches || !passwordMatches) {
      this.recordFailedAttempt(attemptKey);
      this.writeLoginPage(res, 401, "Invalid username or password.", {}, returnTo);
      return;
    }

    this.loginAttempts.delete(attemptKey);
    const now = nowIso();
    this.store.upsertReviewerUser(now);
    const sessionToken = randomToken(32);
    this.store.createDashboardSession(
      hashSecret(sessionToken),
      REVIEWER_DEMO_USER_ID,
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      now,
    );
    if (returnTo) {
      this.redirectTo(res, returnTo, [this.sessionCookie(sessionToken), this.csrfCookie("", 0)]);
    } else {
      this.writeReadyPage(res, [this.sessionCookie(sessionToken)]);
    }
  }

  async handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") throw safeError("FORBIDDEN", "Method not allowed", 405);
    this.assertSameOrigin(req);
    this.assertFormRequest(req);
    const form = await readJsonOrForm(req);
    if (!this.consumeCsrfToken(req, form.csrf ?? "")) {
      throw safeError("FORBIDDEN", "Reviewer logout request could not be verified", 403);
    }
    const token = this.cookieValue(req, SESSION_COOKIE);
    if (token && /^[A-Za-z0-9_-]{43}$/u.test(token)) {
      const tokenHash = hashSecret(token);
      const session = this.store.getDashboardSession(tokenHash, nowIso());
      if (
        session?.userId === REVIEWER_DEMO_USER_ID &&
        this.store.getUserById(session.userId)?.provider === "demo"
      ) {
        this.store.deleteDashboardSession(tokenHash);
      }
    }
    res.writeHead(303, {
      ...addNoStore(),
      Location: "/oauth/reviewer/login",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": [this.sessionCookie("", 0), this.csrfCookie("", 0)],
    });
    res.end();
  }

  private parseReturnTo(value: string | undefined): string | undefined {
    if (!value || value.length > 4_096) return undefined;
    try {
      const target = new URL(value, this.config.publicBaseUrl);
      if (
        target.origin !== new URL(this.config.publicBaseUrl).origin ||
        target.pathname !== "/oauth/authorize" ||
        target.hash
      ) {
        return undefined;
      }
      return `${target.pathname}${target.search}`;
    } catch {
      return undefined;
    }
  }

  private redirectTo(res: ServerResponse, location: string, cookies: string[] = []): void {
    res.writeHead(303, {
      ...addNoStore(),
      Location: location,
      "Referrer-Policy": "no-referrer",
      ...(cookies.length > 0 ? { "Set-Cookie": cookies } : {}),
    });
    res.end();
  }

  private assertSameOrigin(req: IncomingMessage): void {
    const expectedOrigin = new URL(this.config.publicBaseUrl).origin;
    const fetchSite = req.headers["sec-fetch-site"];
    if (
      req.headers.origin !== expectedOrigin ||
      (fetchSite !== undefined && fetchSite !== "same-origin")
    ) {
      throw safeError("FORBIDDEN", "Cross-origin reviewer authentication is not allowed", 403);
    }
  }

  private assertFormRequest(req: IncomingMessage): void {
    if (
      !String(req.headers["content-type"] ?? "")
        .toLowerCase()
        .includes("application/x-www-form-urlencoded")
    ) {
      throw safeError("INVALID_CLIENT", "Expected a URL-encoded reviewer form", 415);
    }
  }

  private cookieValue(req: IncomingMessage, name: string): string | undefined {
    const prefix = `${name}=`;
    const entry = (req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    return entry?.slice(prefix.length);
  }

  private issueCsrfToken(): string {
    const now = Date.now();
    for (const [tokenHash, expiresAt] of this.csrfTokens) {
      if (expiresAt <= now) this.csrfTokens.delete(tokenHash);
    }
    const token = randomToken(32);
    this.csrfTokens.set(hashSecret(token), now + CSRF_TTL_MS);
    this.trimMap(this.csrfTokens);
    return token;
  }

  private consumeCsrfToken(req: IncomingMessage, submittedToken: string): boolean {
    const cookieToken = this.cookieValue(req, CSRF_COOKIE);
    if (!cookieToken || !submittedToken) return false;
    const cookieHash = hashSecret(cookieToken);
    const submittedHash = hashSecret(submittedToken);
    if (!timingSafeEqual(Buffer.from(cookieHash), Buffer.from(submittedHash))) return false;
    const expiresAt = this.csrfTokens.get(cookieHash);
    if (!expiresAt || expiresAt <= Date.now()) {
      this.csrfTokens.delete(cookieHash);
      return false;
    }
    this.csrfTokens.delete(cookieHash);
    return true;
  }

  private loginAttemptKey(req: IncomingMessage, username: string): string {
    const peer = req.socket?.remoteAddress ?? "unknown";
    // In-memory only, never persisted or logged. Avoid treating a username as a password hash.
    return `${peer}:${username.trim().toLowerCase()}`;
  }

  private isRateLimited(key: string): boolean {
    const now = Date.now();
    for (const [attemptKey, attempt] of this.loginAttempts) {
      if (attempt.expiresAt <= now) this.loginAttempts.delete(attemptKey);
    }
    return (this.loginAttempts.get(key)?.count ?? 0) >= LOGIN_MAX_FAILURES;
  }

  private recordFailedAttempt(key: string): void {
    const now = Date.now();
    const previous = this.loginAttempts.get(key);
    const current =
      previous && previous.expiresAt > now
        ? { count: previous.count + 1, expiresAt: previous.expiresAt }
        : { count: 1, expiresAt: now + LOGIN_WINDOW_MS };
    this.loginAttempts.set(key, current);
    this.trimMap(this.loginAttempts);
  }

  private trimMap<T>(map: Map<string, T>): void {
    while (map.size > MAX_TRACKED_TOKENS) {
      const oldest = map.keys().next().value;
      if (typeof oldest !== "string") return;
      map.delete(oldest);
    }
  }

  private sessionCookie(value: string, maxAge = SESSION_TTL_MS / 1_000): string {
    const secure = this.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${SESSION_COOKIE}=${value}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private csrfCookie(value: string, maxAge = CSRF_TTL_MS / 1_000): string {
    const secure = this.config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    return `${CSRF_COOKIE}=${value}; Path=/oauth/reviewer; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  private writeHtml(
    res: ServerResponse,
    status: number,
    html: string,
    cookies: string[] = [],
    extraHeaders: Record<string, string> = {},
  ): void {
    res.writeHead(status, {
      ...addNoStore(),
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
      ...(cookies.length > 0 ? { "Set-Cookie": cookies } : {}),
    });
    res.end(html);
  }

  private writeLoginPage(
    res: ServerResponse,
    status: number,
    error?: string,
    extraHeaders: Record<string, string> = {},
    returnTo?: string,
  ): void {
    const csrf = this.issueCsrfToken();
    const errorMarkup = error
      ? ['<p class="error" role="alert">', escapeHtml(error), "</p>"].join("")
      : "";
    this.writeHtml(
      res,
      status,
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>OpenAI reviewer sign in — ssh-mcp-pro</title>",
        "<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b1220;color:#edf2f7;font-family:Inter,system-ui,sans-serif}.card{width:min(100%,440px);padding:32px;border:1px solid #29364a;border-radius:18px;background:#121d2e;box-shadow:0 24px 70px #0006}.eyebrow{display:inline-flex;padding:6px 10px;border:1px solid #315d53;border-radius:999px;background:#16372f;color:#a7f3d0;font-size:12px;font-weight:700;letter-spacing:.04em}.mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:22px;border-radius:14px;background:#1c2c43;color:#a8c7ff;font-size:24px}h1{margin:18px 0 8px;font-size:26px;letter-spacing:-.03em}p{color:#b6c2d2;font-size:14px;line-height:1.6}.field{display:grid;gap:7px;margin:18px 0}.field label{font-size:13px;font-weight:650;color:#dce6f3}.field input{width:100%;min-height:46px;padding:11px 13px;border:1px solid #3a4b62;border-radius:9px;background:#0b1422;color:#f8fafc;font:inherit}.field input:focus{outline:3px solid #3b82f655;border-color:#60a5fa}.button{width:100%;min-height:48px;margin-top:10px;border:0;border-radius:10px;background:#3978d6;color:#fff;font-size:15px;font-weight:700;cursor:pointer}.button:focus-visible{outline:3px solid #bfdbfe;outline-offset:3px}.note{margin:18px 0 0;padding-top:16px;border-top:1px solid #29364a;font-size:12px}.error{padding:10px 12px;border:1px solid #7f3d48;border-radius:8px;background:#3a1f2a;color:#fecdd3}</style>",
        '</head><body><main class="card" aria-labelledby="reviewer-title">',
        '<div class="mark" aria-hidden="true">⌘</div>',
        '<span class="eyebrow">REVIEWER ACCESS</span>',
        '<h1 id="reviewer-title">Sign in to the review sandbox</h1>',
        "<p>Use the reviewer credentials supplied with the OpenAI app review. This account is isolated from owner accounts and production devices.</p>",
        '<p class="eyebrow">Review sandbox — synthetic data only</p>',
        errorMarkup,
        '<form method="post" action="/oauth/reviewer/login">',
        ['<input type="hidden" name="csrf" value="', csrf, '">'].join(""),
        ...(returnTo
          ? [['<input type="hidden" name="return_to" value="', escapeHtml(returnTo), '">'].join("")]
          : []),
        '<div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" required maxlength="128"></div>',
        '<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>',
        '<button class="button" type="submit">Continue to sample environment</button>',
        "</form>",
        '<p class="note">The reviewer account can inspect sample devices and synthetic system status only. It cannot access real hosts, production records, or execute commands.</p>',
        "</main></body></html>",
      ].join(""),
      [this.csrfCookie(csrf)],
      extraHeaders,
    );
  }

  private writeReadyPage(res: ServerResponse, cookies: string[] = []): void {
    const csrf = this.issueCsrfToken();
    this.writeHtml(
      res,
      200,
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>Reviewer session ready — ssh-mcp-pro</title>",
        "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b1220;color:#edf2f7;font-family:Inter,system-ui,sans-serif}.card{width:min(100%,440px);padding:32px;border:1px solid #29364a;border-radius:18px;background:#121d2e;text-align:center}.status{display:inline-flex;padding:6px 10px;border:1px solid #315d53;border-radius:999px;background:#16372f;color:#a7f3d0;font-size:12px;font-weight:700}h1{font-size:25px}p{color:#b6c2d2;font-size:14px;line-height:1.6}.button{min-height:44px;padding:0 18px;border:1px solid #42536b;border-radius:9px;background:#1b2a3f;color:#e8eef8;font-weight:650;cursor:pointer}</style>",
        '</head><body><main class="card"><span class="status">REVIEWER SESSION READY</span>',
        "<h1>You're signed in</h1>",
        "<p>The OpenAI review sandbox is ready. Return to ChatGPT to continue reviewing SSH Device Inspector.</p>",
        "<p><strong>Only synthetic sample data is available.</strong> No production account, real device, or command execution is accessible.</p>",
        '<form method="post" action="/oauth/reviewer/logout">',
        ['<input type="hidden" name="csrf" value="', csrf, '">'].join(""),
        '<button class="button" type="submit">Sign out</button></form>',
        "</main></body></html>",
      ].join(""),
      [...cookies, this.csrfCookie(csrf)],
    );
  }

  private unavailablePage(): string {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reviewer access unavailable</title></head><body><main><h1>Reviewer access unavailable</h1><p>This review environment is not enabled.</p></main></body></html>';
  }
}
