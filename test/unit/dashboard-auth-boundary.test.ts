import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { describe, expect, test } from "vitest";
import { DashboardAuthHandler } from "../../src/remote/web-dashboard-auth.js";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { hashSecret, randomToken } from "../../src/remote/crypto.js";
import { captureResponse, request, testConfig } from "../helpers/web-dashboard-fixture.js";

describe("dashboard authentication boundary", () => {
  test("preserves session lookup, expiry, logout, account identity and browser mutation guard", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dashboard-auth-fixture-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    try {
      await cp.initialize();
      const auth = new DashboardAuthHandler({
        config: cp.config,
        store: cp.store,
        oauth: cp.oauth,
      });
      const user = cp.oauth.upsertGitHubUser({ id: "101", login: "fixture-account" });
      const token = randomToken(32);
      const now = new Date().toISOString();
      cp.store.createDashboardSession(
        hashSecret(token),
        user.id,
        new Date(Date.now() + 60_000).toISOString(),
        now,
      );
      const headers = { cookie: "ssh_mcp_web_session=" + token };
      expect(auth.getPrincipalFromSession(request("GET", "/", headers))).toMatchObject({
        userId: user.id,
        provider: "github",
      });
      expect(
        auth.getPrincipalFromSession(
          request("GET", "/", { cookie: "ssh_mcp_web_session=invalid" }),
        ),
      ).toBeUndefined();
      const response = captureResponse();
      auth.handleApiMe(
        request("GET", "/api/dashboard/me", headers),
        response as unknown as ServerResponse,
      );
      expect(JSON.parse(response.body)).toMatchObject({
        authenticated: true,
        user: { id: user.id },
      });
      expect(() =>
        auth.assertBrowserMutation(
          request("POST", "/", {
            origin: cp.config.publicBaseUrl,
            "x-ssh-mcp-dashboard": "1",
            "sec-fetch-site": "same-origin",
          }),
        ),
      ).not.toThrow();
      expect(() =>
        auth.assertBrowserMutation(
          request("POST", "/", {
            origin: cp.config.publicBaseUrl,
            "x-ssh-mcp-dashboard": "1",
            "sec-fetch-site": "cross-site",
          }),
        ),
      ).toThrow("Cross-site dashboard mutation is not allowed");
      expect(() =>
        auth.assertBrowserMutation(request("POST", "/", { origin: cp.config.publicBaseUrl })),
      ).toThrow("Cross-site dashboard mutation is not allowed");
      const logout = captureResponse();
      expect(
        await auth.handleAuthRoutes(
          request("GET", "/auth/logout", headers),
          logout as unknown as ServerResponse,
          "/auth/logout",
        ),
      ).toBe(true);
      expect(logout.statusCode).toBe(302);
      expect(logout.getHeader("set-cookie")).toContain("Max-Age=0");
      expect(auth.getPrincipalFromSession(request("GET", "/", headers))).toBeUndefined();
      cp.store.createDashboardSession(
        hashSecret(token),
        user.id,
        new Date(Date.now() - 60_000).toISOString(),
        now,
      );
      expect(auth.getPrincipalFromSession(request("GET", "/", headers))).toBeUndefined();
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
