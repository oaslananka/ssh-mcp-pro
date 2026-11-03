import { describe, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import type { RemoteConfig } from "../../src/remote/types.js";
import {
  fetchGitHubUserDirect,
  fetchGoogleUserDirect,
} from "../../src/remote/web-dashboard-oauth-users.js";
import {
  captureResponse,
  jsonRequest,
  request,
  testConfig,
} from "../helpers/web-dashboard-fixture.js";

describe("Hosted OAuth providers and tenant isolation", () => {
  test("completes mock GitHub OAuth and keeps device operations tenant-scoped", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dashboard-github-test-"));
    let githubUser = { id: 101, login: "first-account" };
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "mock-provider-access-token" });
      }
      if (url === "https://api.github.com/user") return Response.json(githubUser);
      throw new Error(`Unexpected external request: ${url}`);
    });
    vi.stubGlobal("fetch", mockFetch);
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      async function signIn() {
        const authorize = captureResponse();
        await cp.handleHttp(
          request("GET", "/auth/login/github"),
          authorize as unknown as ServerResponse,
          "/auth/login/github",
        );
        expect(authorize.statusCode).toBe(302);
        const oauthLocation = new URL(String(authorize.getHeader("location")));
        expect(oauthLocation.origin).toBe("https://github.com");
        expect(oauthLocation.searchParams.get("redirect_uri")).toBe(
          "http://127.0.0.1:3000/auth/callback/github",
        );
        const state = oauthLocation.searchParams.get("state")!;
        const transactionCookie = String(authorize.getHeader("set-cookie")).split(";")[0];
        expect(transactionCookie).toBe(`ssh_mcp_web_tx=${state}`);
        const endpoint = `/auth/callback/github?state=${encodeURIComponent(state)}&code=one-time-code`;
        const callback = captureResponse();
        await cp.handleHttp(
          request("GET", endpoint, { cookie: transactionCookie }),
          callback as unknown as ServerResponse,
          "/auth/callback/github",
        );
        expect(callback.statusCode).toBe(302);
        const cookies = callback.getHeader("set-cookie");
        expect(Array.isArray(cookies)).toBe(true);
        const session = /ssh_mcp_web_session=([^;]+)/u.exec(String((cookies as string[])[0]))?.[1];
        expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        await expect(
          cp.handleHttp(
            request("GET", endpoint, { cookie: transactionCookie }),
            captureResponse() as unknown as ServerResponse,
            "/auth/callback/github",
          ),
        ).rejects.toMatchObject({ status: 403 });
        return `ssh_mcp_web_session=${session}`;
      }
      const firstCookie = await signIn();
      githubUser = { id: 202, login: "second-account" };
      const secondCookie = await signIn();

      const mutationHeaders = { origin: "http://127.0.0.1:3000", "x-ssh-mcp-dashboard": "1" };
      const enrolled = captureResponse();
      await cp.handleHttp(
        jsonRequest(
          "POST",
          "/api/dashboard/devices/enroll",
          {
            alias: "safe's machine",
            requested_profile: "read-only",
          },
          { cookie: firstCookie, ...mutationHeaders },
        ),
        enrolled as unknown as ServerResponse,
        "/api/dashboard/devices/enroll",
      );
      expect(enrolled.statusCode).toBe(201);
      const data = JSON.parse(enrolled.body);
      expect(data.commands.linux).toContain("safe'\\''s machine");
      expect(data.commands.windows).toContain("safe''s machine");
      const ownerList = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/devices", { cookie: firstCookie }),
        ownerList as unknown as ServerResponse,
        "/api/dashboard/devices",
      );
      const deviceId = JSON.parse(ownerList.body).devices[0].id as string;
      expect(deviceId).toBeTruthy();
      const secondList = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/devices", { cookie: secondCookie }),
        secondList as unknown as ServerResponse,
        "/api/dashboard/devices",
      );
      expect(JSON.parse(secondList.body).devices).toEqual([]);

      for (const method of ["PATCH", "DELETE"] as const) {
        const endpoint = `/api/dashboard/devices/${deviceId}`;
        const response = captureResponse();
        await cp.handleHttp(
          jsonRequest(
            method,
            endpoint,
            { policy: { profile: "read-only" } },
            { cookie: secondCookie, ...mutationHeaders },
          ),
          response as unknown as ServerResponse,
          endpoint,
        );
        expect(response.statusCode).toBe(404);
      }
      const endpoint = `/api/dashboard/devices/${deviceId}`;
      const updated = captureResponse();
      await cp.handleHttp(
        jsonRequest(
          "PATCH",
          endpoint,
          { policy: { profile: "read-only" } },
          { cookie: firstCookie, ...mutationHeaders },
        ),
        updated as unknown as ServerResponse,
        endpoint,
      );
      expect(updated.statusCode).toBe(200);
      expect(JSON.parse(updated.body).device.profile).toBe("read-only");
      const audit = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/audit", { cookie: firstCookie }),
        audit as unknown as ServerResponse,
        "/api/dashboard/audit",
      );
      expect(JSON.parse(audit.body).events.length).toBeGreaterThan(0);
      const otherAudit = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/audit", { cookie: secondCookie }),
        otherAudit as unknown as ServerResponse,
        "/api/dashboard/audit",
      );
      const secondEvents = JSON.parse(otherAudit.body).events as { eventType: string }[];
      expect(secondEvents.length).toBeGreaterThan(0); // Their own sign-in audit is allowed.
      expect(secondEvents.every((event) => event.eventType === "user_login")).toBe(true);
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });

  test("verifies real Google OIDC signatures, nonce, email and provider failures", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dashboard-google-oidc-"));
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "oidc-test-key", alg: "RS256", use: "sig" };
    let responseIdToken = "";
    let status = 200;
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json({ keys: [jwk] });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ id_token: responseIdToken }, { status });
      }
      throw new Error(`Unexpected outbound Google request: ${url}`);
    });
    vi.stubGlobal("fetch", mockFetch);
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      async function authorize() {
        const response = captureResponse();
        await cp.handleHttp(
          request("GET", "/auth/login/google"),
          response as unknown as ServerResponse,
          "/auth/login/google",
        );
        expect(response.statusCode).toBe(302);
        const target = new URL(String(response.getHeader("location")));
        expect(target.origin).toBe("https://accounts.google.com");
        expect(target.searchParams.get("scope")).toContain("openid");
        const state = target.searchParams.get("state")!;
        const nonce = target.searchParams.get("nonce")!;
        expect(nonce.length).toBeGreaterThan(20);
        return { state, nonce, cookie: String(response.getHeader("set-cookie")).split(";")[0] };
      }
      async function createToken(nonce: string, overrides: Record<string, unknown> = {}) {
        return new SignJWT({
          email: "signed-in@example.com",
          email_verified: true,
          name: "Verified Google User",
          nonce,
          ...overrides,
        })
          .setProtectedHeader({ alg: "RS256", kid: "oidc-test-key" })
          .setSubject("subject-420")
          .setIssuer("https://accounts.google.com")
          .setAudience("test-google-client")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
      }
      async function callback(tx: { state: string; cookie: string }) {
        const endpoint = `/auth/callback/google?state=${encodeURIComponent(tx.state)}&code=oidc-test-code`;
        const result = captureResponse();
        await cp.handleHttp(
          request("GET", endpoint, { cookie: tx.cookie }),
          result as unknown as ServerResponse,
          "/auth/callback/google",
        );
        return result;
      }
      const first = await authorize();
      responseIdToken = await createToken(first.nonce);
      const authenticated = await callback(first);
      expect(authenticated.statusCode).toBe(302);
      const cookies = authenticated.getHeader("set-cookie") as string[];
      expect(cookies[0]).toContain("ssh_mcp_web_session=");
      expect(cookies[1]).toContain("ssh_mcp_web_tx=;");
      const sessionCookie = cookies[0].split(";")[0];
      const currentUser = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/me", { cookie: sessionCookie }),
        currentUser as unknown as ServerResponse,
        "/api/dashboard/me",
      );
      expect(JSON.parse(currentUser.body).user.email).toBe("signed-in@example.com");
      expect(JSON.parse(currentUser.body).user.provider).toBe("google");
      expect(mockFetch).toHaveBeenCalled();

      // A valid signature alone is insufficient: the nonce and identity must match.
      for (const invalidClaims of [
        { nonce: "incorrect-nonce" },
        { email_verified: false },
        { email: "" },
        { email: 10 },
      ]) {
        const next = await authorize();
        responseIdToken = await createToken(next.nonce, invalidClaims);
        await expect(callback(next)).rejects.toMatchObject({ status: 403 });
      }
      const wrongAudience = await authorize();
      responseIdToken = await createToken(wrongAudience.nonce);
      // Signed by the expected key, but issued for a different audience.
      responseIdToken = await new SignJWT({
        email: "signed-in@example.com",
        email_verified: true,
        nonce: wrongAudience.nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "oidc-test-key" })
        .setSubject("subject-420")
        .setIssuer("https://accounts.google.com")
        .setAudience("different-client")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      await expect(callback(wrongAudience)).rejects.toMatchObject({ status: 403 });

      // Valid provider signatures with optional profile claims still create a session.
      const fallbackProfile = await authorize();
      responseIdToken = await createToken(fallbackProfile.nonce, {
        name: null,
        picture: "https://example.invalid/avatar.png",
      });
      const fallbackResponse = await callback(fallbackProfile);
      expect(fallbackResponse.statusCode).toBe(302);
      const fallbackIdentity = await fetchGoogleUserDirect(
        testConfig(dir),
        "code",
        fallbackProfile.nonce,
      );
      expect(fallbackIdentity.name).toBe("signed-in@example.com");
      expect(fallbackIdentity.picture).toBe("https://example.invalid/avatar.png");

      await expect(
        fetchGoogleUserDirect(
          { ...testConfig(dir), googleClientId: undefined },
          "code",
          fallbackProfile.nonce,
        ),
      ).rejects.toMatchObject({ status: 502 });
      await expect(fetchGoogleUserDirect(testConfig(dir), "code", "")).rejects.toMatchObject({
        status: 502,
      });

      const failedExchange = await authorize();
      responseIdToken = "";
      status = 400;
      await expect(callback(failedExchange)).rejects.toMatchObject({ status: 502 });
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });

  test("fails closed on missing OAuth configuration and malformed GitHub identities", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dashboard-provider-errors-"));
    const config: RemoteConfig = {
      ...testConfig(dir),
      githubClientId: undefined,
      githubClientSecret: undefined,
      googleClientId: undefined,
      googleClientSecret: undefined,
    };
    const cp = new RemoteControlPlane(config);
    await cp.initialize();
    try {
      for (const provider of ["github", "google"] as const) {
        const endpoint = `/auth/login/${provider}`;
        await expect(
          cp.handleHttp(
            request("GET", endpoint),
            captureResponse() as unknown as ServerResponse,
            endpoint,
          ),
        ).rejects.toMatchObject({ status: 503 });
      }
      const validConfig = testConfig(dir);
      let access: Record<string, unknown> = {};
      let profile: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url === "https://github.com/login/oauth/access_token") return Response.json(access);
          if (url === "https://api.github.com/user") return Response.json(profile);
          throw new Error(`Unexpected OAuth test network call ${url}`);
        }),
      );
      await expect(fetchGitHubUserDirect(validConfig, "code")).rejects.toMatchObject({
        status: 502,
      });
      access = { access_token: "provider-token" };
      for (const invalidProfile of [
        {},
        { id: "not-a-number", login: "member" },
        { id: 123, login: "" },
        { id: 123, login: null },
      ]) {
        profile = invalidProfile;
        await expect(fetchGitHubUserDirect(validConfig, "code")).rejects.toMatchObject({
          status: 502,
        });
      }
      profile = { id: 123, login: "member" };
      expect(await fetchGitHubUserDirect(validConfig, "code")).toEqual({
        id: "123",
        login: "member",
      });
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });
});
