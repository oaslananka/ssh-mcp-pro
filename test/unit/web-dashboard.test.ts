import { describe, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { loadRemoteConfig } from "../../src/remote/config.js";
import type { RemoteConfig } from "../../src/remote/types.js";
import {
  fetchGitHubUserDirect,
  fetchGoogleUserDirect,
} from "../../src/remote/web-dashboard-oauth-users.js";

function testConfig(dir: string): RemoteConfig {
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

function request(
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

function jsonRequest(
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

function captureResponse() {
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

describe("Web Dashboard and Multi-provider OAuth", () => {
  test("serves HTML dashboard on root and /dashboard", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dashboard-test-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      const res = captureResponse();
      const handled = await cp.handleHttp(
        request("GET", "/"),
        res as unknown as ServerResponse,
        "/",
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.getHeader("content-type")).toContain("text/html");
      expect(res.body).toContain("ssh-mcp-pro");
      expect(res.body).toContain("Sign in with Google");
      expect(res.body).toContain("Sign in with GitHub");
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serves install scripts via HTTP", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "scripts-test-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      const resSh = captureResponse();
      const handledSh = await cp.handleHttp(
        request("GET", "/install-agent.sh"),
        resSh as unknown as ServerResponse,
        "/install-agent.sh",
      );
      expect(handledSh).toBe(true);
      expect(resSh.statusCode).toBe(200);
      expect(resSh.body).toContain("#!/usr/bin/env bash");

      const resPs = captureResponse();
      const handledPs = await cp.handleHttp(
        request("GET", "/install-agent.ps1"),
        resPs as unknown as ServerResponse,
        "/install-agent.ps1",
      );
      expect(handledPs).toBe(true);
      expect(resPs.statusCode).toBe(200);
      expect(resPs.body).toContain("install-agent");
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns client configuration guides for Claude, ChatGPT, Gemini, and Local stdio", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "configs-test-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      const res = captureResponse();
      const handled = await cp.handleHttp(
        request("GET", "/api/dashboard/client-configs"),
        res as unknown as ServerResponse,
        "/api/dashboard/client-configs",
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.clients.claudeDesktopRemote.mcpServers["ssh-mcp-pro"].transport).toBe(
        "streamable-http",
      );
      expect(parsed.clients.claudeDesktopLocal.mcpServers["ssh-mcp-pro"].command).toBe(
        "ssh-mcp-pro",
      );
      expect(parsed.clients.geminiExtension.mcpEndpoint).toBe("http://127.0.0.1:3000/mcp");
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("authenticates Google and GitHub test users and provides device management", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "google-auth-test-"));
    process.env.SSHAUTOMATOR_TEST_GOOGLE_ID = "google-user-123";
    process.env.SSHAUTOMATOR_TEST_GOOGLE_EMAIL = "dev@example.com";
    process.env.SSHAUTOMATOR_TEST_GOOGLE_NAME = "Osman Aslan";

    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      // 1. Direct login redirect with Google
      const loginRes = captureResponse();
      await cp.handleHttp(
        request("GET", "/auth/login/google"),
        loginRes as unknown as ServerResponse,
        "/auth/login/google",
      );
      expect(loginRes.statusCode).toBe(302);
      expect(loginRes.getHeader("location")).toBe("/dashboard");
      const cookie = String(loginRes.getHeader("set-cookie"));
      expect(cookie).toContain("ssh_mcp_web_session=");

      // Extract cookie value
      const match = /ssh_mcp_web_session=([^;]+)/.exec(cookie);
      expect(match).not.toBeNull();
      const token = match![1];
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u); // Opaque session, never an MCP bearer JWT.

      // 2. Check /api/dashboard/me with session cookie
      const meRes = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/me", { cookie: `ssh_mcp_web_session=${token}` }),
        meRes as unknown as ServerResponse,
        "/api/dashboard/me",
      );
      expect(meRes.statusCode).toBe(200);
      const meData = JSON.parse(meRes.body);
      expect(meData.authenticated).toBe(true);
      expect(meData.user.email).toBe("dev@example.com");
      expect(meData.user.displayName).toBe("Osman Aslan");
      expect(meData.user.provider).toBe("google");

      // A dashboard session is opaque and must never authenticate via a bearer header.
      const bearerRes = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/me", { authorization: `Bearer ${token}` }),
        bearerRes as unknown as ServerResponse,
        "/api/dashboard/me",
      );
      expect(JSON.parse(bearerRes.body).authenticated).toBe(false);

      // Mutations without the exact browser origin are rejected.
      await expect(
        cp.handleHttp(
          jsonRequest(
            "POST",
            "/api/dashboard/devices/enroll",
            { alias: "rejected-device" },
            {
              cookie: `ssh_mcp_web_session=${token}`,
              origin: "https://different-origin.example",
              "x-ssh-mcp-dashboard": "1",
            },
          ),
          captureResponse() as unknown as ServerResponse,
          "/api/dashboard/devices/enroll",
        ),
      ).rejects.toMatchObject({ status: 403 });

      // 3. Generate device enrollment command
      const enrollRes = captureResponse();
      await cp.handleHttp(
        jsonRequest(
          "POST",
          "/api/dashboard/devices/enroll",
          { alias: "test-vps", requested_profile: "operations" },
          {
            cookie: `ssh_mcp_web_session=${token}`,
            origin: "http://127.0.0.1:3000",
            "x-ssh-mcp-dashboard": "1",
          },
        ),
        enrollRes as unknown as ServerResponse,
        "/api/dashboard/devices/enroll",
      );
      expect(enrollRes.statusCode).toBe(201);
      const enrollData = JSON.parse(enrollRes.body);
      expect(enrollData.commands.linux).toContain("install-agent.sh");
      expect(enrollData.commands.windows).toContain("install-agent.ps1");
      expect(enrollData.commands.npm).toContain("ssh-mcp-pro-agent enroll");
      expect(enrollData.commands.npm).toContain("--package ssh-mcp-pro@latest");
      expect(enrollData.commands.windows).toContain("[scriptblock]::Create");

      // 4. List devices
      const listRes = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/devices", { cookie: `ssh_mcp_web_session=${token}` }),
        listRes as unknown as ServerResponse,
        "/api/dashboard/devices",
      );
      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.body);
      expect(listData.devices.length).toBe(1);
      expect(listData.devices[0].alias).toBe("test-vps");

      // 5. Revoke device
      const revokeRes = captureResponse();
      await cp.handleHttp(
        request("DELETE", `/api/dashboard/devices/${listData.devices[0].id}`, {
          cookie: `ssh_mcp_web_session=${token}`,
          origin: "http://127.0.0.1:3000",
          "x-ssh-mcp-dashboard": "1",
        }),
        revokeRes as unknown as ServerResponse,
        `/api/dashboard/devices/${listData.devices[0].id}`,
      );
      expect(revokeRes.statusCode).toBe(200);

      // 6. Sign out
      const logoutRes = captureResponse();
      await cp.handleHttp(
        request("GET", "/auth/logout", { cookie: `ssh_mcp_web_session=${token}` }),
        logoutRes as unknown as ServerResponse,
        "/auth/logout",
      );
      expect(logoutRes.statusCode).toBe(302);
      expect(logoutRes.getHeader("location")).toBe("/");
      expect(String(logoutRes.getHeader("set-cookie"))).toContain("Max-Age=0");
      const signedOutRes = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/me", { cookie: `ssh_mcp_web_session=${token}` }),
        signedOutRes as unknown as ServerResponse,
        "/api/dashboard/me",
      );
      expect(JSON.parse(signedOutRes.body).authenticated).toBe(false);
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
      delete process.env.SSHAUTOMATOR_TEST_GOOGLE_ID;
      delete process.env.SSHAUTOMATOR_TEST_GOOGLE_EMAIL;
      delete process.env.SSHAUTOMATOR_TEST_GOOGLE_NAME;
    }
  });

  test("rejects anonymous device operations and cross-origin browser mutations", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dashboard-guard-test-"));
    const cp = new RemoteControlPlane(testConfig(dir));
    await cp.initialize();
    try {
      for (const endpoint of ["/api/dashboard/devices", "/api/dashboard/audit"]) {
        const response = captureResponse();
        await cp.handleHttp(
          request("GET", endpoint),
          response as unknown as ServerResponse,
          endpoint,
        );
        expect(response.statusCode).toBe(401);
      }

      const protectedEndpoints = [
        ["POST", "/api/dashboard/devices/enroll"],
        ["PATCH", "/api/dashboard/devices/example"],
        ["DELETE", "/api/dashboard/devices/example"],
      ] as const;
      for (const [method, endpoint] of protectedEndpoints) {
        for (const headers of [
          {},
          { origin: "https://attacker.example", "x-ssh-mcp-dashboard": "1" },
          { origin: "http://127.0.0.1:3000" },
          {
            origin: "http://127.0.0.1:3000",
            "x-ssh-mcp-dashboard": "1",
            "sec-fetch-site": "cross-site",
          },
        ]) {
          await expect(
            cp.handleHttp(
              jsonRequest(method, endpoint, { policy: {} }, headers),
              captureResponse() as unknown as ServerResponse,
              endpoint,
            ),
          ).rejects.toMatchObject({ status: 403 });
        }
      }

      // Mutations with correct origin are still denied without a login.
      const noLogin = captureResponse();
      await cp.handleHttp(
        jsonRequest(
          "POST",
          "/api/dashboard/devices/enroll",
          { alias: "device" },
          {
            origin: "http://127.0.0.1:3000",
            "x-ssh-mcp-dashboard": "1",
            "sec-fetch-site": "same-origin",
          },
        ),
        noLogin as unknown as ServerResponse,
        "/api/dashboard/devices/enroll",
      );
      expect(noLogin.statusCode).toBe(401);

      for (const endpoint of ["/auth/callback/github", "/auth/callback/google"]) {
        await expect(
          cp.handleHttp(
            request("GET", `${endpoint}?code=unknown&state=missing`),
            captureResponse() as unknown as ServerResponse,
            endpoint,
          ),
        ).rejects.toMatchObject({ status: 403 });
      }
      for (const provider of ["github", "google"] as const) {
        const login = `/auth/login/${provider}`;
        const callback = `/auth/callback/${provider}`;
        const authorize = captureResponse();
        await cp.handleHttp(request("GET", login), authorize as unknown as ServerResponse, login);
        const state = new URL(String(authorize.getHeader("location"))).searchParams.get("state")!;
        const route = `${callback}?state=${encodeURIComponent(state)}&code=valid`;
        await expect(
          cp.handleHttp(
            request("GET", route, { cookie: "ssh_mcp_web_tx=wrong-state" }),
            captureResponse() as unknown as ServerResponse,
            callback,
          ),
        ).rejects.toMatchObject({ status: 403 });
        // A failed callback must invalidate that authorization transaction.
        await expect(
          cp.handleHttp(
            request("GET", route, {
              cookie: `ssh_mcp_web_tx=${state}`,
            }),
            captureResponse() as unknown as ServerResponse,
            callback,
          ),
        ).rejects.toMatchObject({ status: 403 });
      }
      const invalidSession = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/me", {
          cookie: "ssh_mcp_web_session=malformed",
        }),
        invalidSession as unknown as ServerResponse,
        "/api/dashboard/me",
      );
      expect(JSON.parse(invalidSession.body).authenticated).toBe(false);
    } finally {
      cp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
