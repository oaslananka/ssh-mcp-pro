import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import {
  captureResponse,
  jsonRequest,
  request,
  testConfig,
} from "../helpers/web-dashboard-fixture.js";

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
      expect(listData.devices).toHaveLength(1);
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
});
