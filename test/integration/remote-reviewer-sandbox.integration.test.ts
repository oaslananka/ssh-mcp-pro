import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { REVIEWER_DEMO_USER_ID } from "../../src/remote/types.js";
import { captureResponse, jsonRequest, request } from "../helpers/web-dashboard-fixture.js";
import {
  REVIEWER_USERNAME,
  REVIEWER_PASSWORD,
  PUBLIC_BASE_URL,
  createControlPlane,
  dispatch,
  setCookie,
  csrfFromPage,
  login,
  authorizationUrl,
  reviewerLoginPage,
  formRequest,
} from "../helpers/reviewer-sandbox-fixture.js";

describe("OpenAI reviewer sandbox browser authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps reviewer login unavailable unless both credentials are configured", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-disabled-"));
    const controlPlane = createControlPlane(dir, false);
    try {
      const result = await reviewerLoginPage(controlPlane);
      expect(result.handled).toBe(true);
      expect(result.response.statusCode).toBe(404);
      expect(result.response.body).not.toContain("openai-reviewer");
      expect(result.response.getHeader("cache-control")).toContain("no-store");
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("renders an accessible synthetic-only login and rejects invalid CSRF and origins", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-form-"));
    const controlPlane = createControlPlane(dir);
    try {
      const page = await reviewerLoginPage(controlPlane);
      expect(page.handled).toBe(true);
      expect(page.response.statusCode).toBe(200);
      expect(page.response.body).toContain('<html lang="en">');
      expect(page.response.body).toContain("Review sandbox — synthetic data only");
      expect(page.response.body).toContain('autocomplete="username"');
      expect(page.response.body).toContain('autocomplete="current-password"');
      expect(page.response.body).toContain('name="username"');
      expect(page.response.body).toContain('name="password"');
      expect(page.response.getHeader("cache-control")).toContain("no-store");
      expect(page.response.getHeader("referrer-policy")).toBe("no-referrer");
      expect(page.response.getHeader("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(setCookie(page.response, "ssh_mcp_reviewer_csrf")).toBeTruthy();

      const missingCsrf = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          { username: REVIEWER_USERNAME, password: REVIEWER_PASSWORD },
          { origin: PUBLIC_BASE_URL },
        ),
        "/oauth/reviewer/login",
      );
      expect(missingCsrf.response.statusCode).toBe(403);

      const csrf = csrfFromPage(page.response.body);
      const csrfCookie = setCookie(page.response, "ssh_mcp_reviewer_csrf")!;
      const crossOrigin = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          { csrf, username: REVIEWER_USERNAME, password: REVIEWER_PASSWORD },
          { origin: "https://attacker.example", cookie: csrfCookie },
        ),
        "/oauth/reviewer/login",
      );
      expect(crossOrigin.response.statusCode).toBe(403);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns to the original OAuth consent request after reviewer login without allowing open redirects", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-return-to-"));
    const controlPlane = createControlPlane(dir);
    try {
      const registered = await dispatch(
        controlPlane,
        jsonRequest("POST", "/oauth/register", {
          client_name: "Reviewer Return-To Test",
          redirect_uris: ["http://localhost/reviewer-return-callback"],
        }),
        "/oauth/register",
      );
      const clientId = String(JSON.parse(registered.response.body).client_id);
      const authorizeUrl = authorizationUrl(
        clientId,
        "http://localhost/reviewer-return-callback",
        "hosts:read agents:read status:read shell:exec",
      );
      const authorize = await dispatch(
        controlPlane,
        request("GET", authorizeUrl),
        "/oauth/authorize",
      );
      const loginHref = /href="([^"]*oauth\/reviewer\/login[^"]*)"/u.exec(
        authorize.response.body,
      )?.[1];
      if (!loginHref) throw new Error("OAuth consent page did not link to reviewer login");
      const loginUrl = new URL(loginHref.replaceAll("&amp;", "&"), PUBLIC_BASE_URL);
      const returnTo = loginUrl.searchParams.get("return_to");
      expect(returnTo).toBe(authorizeUrl);

      const loginPage = await dispatch(
        controlPlane,
        request("GET", `${loginUrl.pathname}${loginUrl.search}`),
        "/oauth/reviewer/login",
      );
      expect(loginPage.response.body).toContain('name="return_to"');
      const csrf = csrfFromPage(loginPage.response.body);
      const csrfCookie = setCookie(loginPage.response, "ssh_mcp_reviewer_csrf")!;
      const invalidReturnTo = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          {
            csrf,
            username: REVIEWER_USERNAME,
            password: REVIEWER_PASSWORD,
            return_to: "https://attacker.example/oauth/authorize?client_id=evil",
          },
          { origin: PUBLIC_BASE_URL, cookie: csrfCookie },
        ),
        "/oauth/reviewer/login",
      );
      expect(invalidReturnTo.response.statusCode).toBe(400);

      const retryPage = await dispatch(
        controlPlane,
        request("GET", `${loginUrl.pathname}${loginUrl.search}`),
        "/oauth/reviewer/login",
      );
      const retryCsrf = csrfFromPage(retryPage.response.body);
      const retryCsrfCookie = setCookie(retryPage.response, "ssh_mcp_reviewer_csrf")!;
      const signedIn = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/login",
          {
            csrf: retryCsrf,
            username: REVIEWER_USERNAME,
            password: REVIEWER_PASSWORD,
            return_to: returnTo!,
          },
          { origin: PUBLIC_BASE_URL, cookie: retryCsrfCookie },
        ),
        "/oauth/reviewer/login",
      );
      expect(signedIn.response.statusCode).toBe(303);
      expect(signedIn.response.getHeader("location")).toBe(returnTo);
      const sessionCookie = setCookie(signedIn.response, "ssh_mcp_reviewer_session")!;
      const resumedAuthorize = await dispatch(
        controlPlane,
        request("GET", returnTo!, { cookie: sessionCookie }),
        "/oauth/authorize",
      );
      expect(resumedAuthorize.response.statusCode).toBe(200);
      expect(resumedAuthorize.response.body).toContain("Review sandbox — synthetic data only");
      expect(resumedAuthorize.response.body).toContain("Continue with reviewer sandbox");
      expect(resumedAuthorize.response.body).not.toContain("shell:exec");
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses generic credential errors, bounds failed attempts, and stores only a hashed session", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-session-"));
    const controlPlane = createControlPlane(dir);
    try {
      const invalid = await login(controlPlane, "wrong-user", "wrong-password");
      expect(invalid.response.statusCode).toBe(401);
      expect(invalid.response.body).toContain("Invalid username or password");
      expect(invalid.response.body).not.toContain("wrong-user");
      expect(controlPlane.store.getUserById(REVIEWER_DEMO_USER_ID)).toBeUndefined();

      const valid = await login(controlPlane);
      expect(valid.response.statusCode).toBe(200);
      expect(valid.response.body).toContain("Reviewer session ready");
      expect(valid.response.body).toContain("synthetic sample data");
      const sessionCookie = setCookie(valid.response, "ssh_mcp_reviewer_session");
      expect(sessionCookie).toBeTruthy();
      const rawToken = sessionCookie!.slice("ssh_mcp_reviewer_session=".length);
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(
        controlPlane.store.getDashboardSession(hashSecret(rawToken), new Date().toISOString()),
      ).toEqual({ userId: REVIEWER_DEMO_USER_ID });
      expect(
        controlPlane.store.getDashboardSession(rawToken, new Date().toISOString()),
      ).toBeUndefined();
      expect(controlPlane.store.getUserById(REVIEWER_DEMO_USER_ID)).toMatchObject({
        provider: "demo",
        githubId: undefined,
        googleId: undefined,
        email: undefined,
      });

      const csrf = csrfFromPage(valid.response.body);
      const csrfCookie = setCookie(valid.response, "ssh_mcp_reviewer_csrf")!;
      const rejectedLogout = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/logout",
          { csrf: "invalid-csrf-token" },
          { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${csrfCookie}` },
        ),
        "/oauth/reviewer/logout",
      );
      expect(rejectedLogout.response.statusCode).toBe(403);
      expect(
        controlPlane.store.getDashboardSession(hashSecret(rawToken), new Date().toISOString()),
      ).toEqual({ userId: REVIEWER_DEMO_USER_ID });

      const ownerNow = new Date().toISOString();
      const ownerToken = randomToken(32);
      controlPlane.store.upsertUser({
        internalId: "github:reviewer-boundary-owner",
        id: "reviewer-boundary-owner",
        login: "reviewer-boundary-owner",
        now: ownerNow,
      });
      controlPlane.store.createDashboardSession(
        hashSecret(ownerToken),
        "github:reviewer-boundary-owner",
        new Date(Date.now() + 60_000).toISOString(),
        ownerNow,
      );
      const ownerLogout = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/logout",
          { csrf },
          {
            origin: PUBLIC_BASE_URL,
            cookie: `ssh_mcp_reviewer_session=${ownerToken}; ${csrfCookie}`,
          },
        ),
        "/oauth/reviewer/logout",
      );
      expect(ownerLogout.response.statusCode).toBe(303);
      expect(
        controlPlane.store.getDashboardSession(hashSecret(ownerToken), new Date().toISOString()),
      ).toEqual({ userId: "github:reviewer-boundary-owner" });

      const refreshedReadyPage = await dispatch(
        controlPlane,
        request("GET", "/oauth/reviewer/login", { cookie: sessionCookie }),
        "/oauth/reviewer/login",
      );
      const logoutCsrf = csrfFromPage(refreshedReadyPage.response.body);
      const logoutCsrfCookie = setCookie(refreshedReadyPage.response, "ssh_mcp_reviewer_csrf")!;
      const logout = await dispatch(
        controlPlane,
        formRequest(
          "POST",
          "/oauth/reviewer/logout",
          { csrf: logoutCsrf },
          { origin: PUBLIC_BASE_URL, cookie: `${sessionCookie}; ${logoutCsrfCookie}` },
        ),
        "/oauth/reviewer/logout",
      );
      expect(logout.response.statusCode).toBe(303);
      const logoutCookies = logout.response.getHeader("set-cookie");
      const logoutCookieLines = Array.isArray(logoutCookies) ? logoutCookies : [logoutCookies];
      expect(logoutCookieLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "ssh_mcp_reviewer_session=; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=0",
          ),
        ]),
      );
      expect(
        controlPlane.store.getDashboardSession(hashSecret(rawToken), new Date().toISOString()),
      ).toBeUndefined();
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("limits a peer and username to five failed attempts in the rolling window", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-login-rate-limit-"));
    const controlPlane = createControlPlane(dir);
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await login(controlPlane, REVIEWER_USERNAME, "wrong-password");
        statuses.push(result.response.statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("treats expired reviewer sessions as signed out", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reviewer-session-expiry-"));
    const controlPlane = createControlPlane(dir);
    try {
      const now = new Date().toISOString();
      const expiredToken = randomToken(32);
      controlPlane.store.upsertReviewerUser(now);
      controlPlane.store.createDashboardSession(
        hashSecret(expiredToken),
        REVIEWER_DEMO_USER_ID,
        new Date(Date.now() - 1_000).toISOString(),
        now,
      );
      const result = await dispatch(
        controlPlane,
        request("GET", "/oauth/reviewer/login", {
          cookie: `ssh_mcp_reviewer_session=${expiredToken}`,
        }),
        "/oauth/reviewer/login",
      );
      expect(result.response.statusCode).toBe(200);
      expect(result.response.body).toContain('name="password"');
      expect(result.response.body).not.toContain("Reviewer session ready");
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
