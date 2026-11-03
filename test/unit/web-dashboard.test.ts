import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { loadRemoteConfig } from "../../src/remote/config.js";
import type { RemoteConfig } from "../../src/remote/types.js";

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
});
