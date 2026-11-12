import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { hashSecret } from "../../src/remote/crypto.js";
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
      for (const snippetId of ["cfgClaudeRemote", "cfgClaudeCode", "cfgChatGptMcp"]) {
        expect(res.body).toContain('id="' + snippetId + '"');
      }
      expect(res.body).toContain("Add custom connector");
      expect(res.body).toContain("Add custom MCP server");
      expect(res.body).not.toContain("ChatGPT Actions / MCP Connector");
      for (const snippetId of ["cfgVsCode", "cfgVsCodePortable", "cfgCursor", "cfgWindsurf"]) {
        expect(res.body).toContain('id="' + snippetId + '"');
      }
      expect(res.body).not.toContain('"mcp.servers"');
      expect(res.body).toContain("Gemini API (Interactions)");
      expect(res.body).toContain('"type": "mcp_server"');
      expect(res.body).toContain('"name": "ssh_mcp_pro"');
      expect(res.body).not.toContain('"endpoint":');
      expect(res.body).toContain("the URL alone does not authenticate");
      expect(res.body).toContain("Copilot portable");
      const parseSetupSnippet = (id: string) => {
        const marker = '<span id="' + id + '">';
        const start = res.body.indexOf(marker);
        expect(start).toBeGreaterThanOrEqual(0);
        const end = res.body.indexOf("</span>", start + marker.length);
        expect(end).toBeGreaterThan(start);
        return JSON.parse(
          res.body
            .slice(start + marker.length, end)
            .replace(/\\n/gu, "\n")
            .replaceAll("$" + "{MCP_URL}", "http://127.0.0.1:3000/mcp"),
        );
      };
      expect(parseSetupSnippet("cfgGemini")).toEqual({
        type: "mcp_server",
        name: "ssh_mcp_pro",
        url: "http://127.0.0.1:3000/mcp",
      });
      expect(parseSetupSnippet("cfgVsCodePortable")).toEqual({
        mcpServers: {
          "ssh-mcp-pro": { type: "http", url: "http://127.0.0.1:3000/mcp" },
        },
      });
      expect(res.body).toContain(".mcp.json");
      expect(res.body).toContain('aria-label="Dashboard sections"');
      for (const tab of ["devices", "add-device", "clients", "audit"]) {
        expect(res.body).toContain('data-dashboard-tab="' + tab + '"');
      }
      expect(res.body).not.toContain('<div class="tab-item');
      expect(res.body).toContain("aria-pressed=");
      expect(res.body).toContain('for="enrollAlias"');
      expect(res.body).toContain('for="enrollProfile"');
      expect(res.body).toContain('aria-label="Policy for');
      expect(res.body).toContain("minmax(min(100%, 320px), 1fr)");
      expect(res.body).toContain('class="device-actions"');
      expect(res.body).toContain("Local Stdio Mode (Policy-Controlled)");
      expect(res.body).toContain(".code-box > span");
      expect(res.body).toContain("escapeHtml(e.agentAlias || e.agentId || e.actionId || '-')");
      expect(res.body).toContain(".card a { color: var(--blue);");
      expect(res.body).toContain(".badge-gray { background: #30363d; color: #c9d1d9; }");
      expect(res.body).toContain('aria-label="Copy ChatGPT MCP URL"');
      expect(res.body).toContain('aria-live="polite"');
      expect(res.body).toContain("feedback('Copy failed')");
      expect(res.body).not.toContain("alert('Copied to clipboard!')");
      expect(res.body).not.toContain("Local Stdio Mode (Unrestricted)");
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
      expect(parsed.clients.claudeRemoteConnector.serverUrl).toBe("http://127.0.0.1:3000/mcp");
      expect(parsed.clients.claudeCodeRemote.command).toBe(
        "claude mcp add --transport http ssh-mcp-pro http://127.0.0.1:3000/mcp",
      );
      expect(parsed.clients.chatgptMcpPlugin.serverUrl).toBe("http://127.0.0.1:3000/mcp");
      expect(parsed.clients).not.toHaveProperty("chatgptCustomGpt");
      expect(parsed.clients.claudeDesktopLocal.mcpServers["ssh-mcp-pro"].command).toBe(
        "ssh-mcp-pro",
      );
      expect(parsed.clients.geminiExtension.mcpEndpoint).toBe("http://127.0.0.1:3000/mcp");
      expect(parsed.clients.geminiInteractions).toEqual({
        type: "mcp_server",
        name: "ssh_mcp_pro",
        url: "http://127.0.0.1:3000/mcp",
      });
      expect(parsed.clients.vscodePortable.mcpServers["ssh-mcp-pro"]).toEqual({
        type: "http",
        url: "http://127.0.0.1:3000/mcp",
      });
      expect(parsed.clients.vscodeCursor.servers["ssh-mcp-pro-cloud"]).toEqual({
        type: "http",
        url: "http://127.0.0.1:3000/mcp",
      });
      expect(parsed.clients.vscodeCursor.servers["ssh-mcp-pro-local"]).toMatchObject({
        type: "stdio",
        command: "ssh-mcp-pro",
      });
      expect(parsed.clients.cursor.mcpServers["ssh-mcp-pro"]).toEqual({
        url: "http://127.0.0.1:3000/mcp",
      });
      expect(parsed.clients.windsurf.mcpServers["ssh-mcp-pro"]).toEqual({
        serverUrl: "http://127.0.0.1:3000/mcp",
      });
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
      expect(enrollData.enrollment_token).toMatch(/^[A-Za-z0-9_-]{30,}$/u);
      for (const platform of ["linux", "windows", "npm"] as const) {
        expect(enrollData.commands[platform]).toContain(enrollData.enrollment_token);
        expect(enrollData.commands[platform]).not.toMatch(/--[Tt]oken\s+''/u);
      }
      if (process.platform !== "win32") {
        // A failed download must fail the copy-paste command, not silently
        // succeed because the trailing bash process receives empty input.
        const fakeBin = path.join(dir, "mock-bin");
        mkdirSync(fakeBin);
        const fakeCurl = path.join(fakeBin, "curl");
        writeFileSync(fakeCurl, "#!/bin/sh\nexit 22\n", { mode: 0o755 });
        chmodSync(fakeCurl, 0o755);
        const result = spawnSync("bash", ["-c", String(enrollData.commands.linux)], {
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
          encoding: "utf8",
          timeout: 3_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(22);

        // The same one-liner must still execute a successfully downloaded
        // script and preserve enrollment arguments.
        writeFileSync(
          fakeCurl,
          `#!/bin/sh
cat <<'INSTALLER'
printf 'agent:%s\n' "$6"
INSTALLER
`,
          { mode: 0o755 },
        );
        const successful = spawnSync("bash", ["-c", String(enrollData.commands.linux)], {
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
          encoding: "utf8",
          timeout: 3_000,
        });
        expect(successful.error).toBeUndefined();
        expect(successful.status).toBe(0);
        expect(successful.stdout.trim()).toBe("agent:test-vps");
      }
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

      // 5. The browser's profile API and explicit revoke operation are distinct.
      const deviceEndpoint = `/api/dashboard/devices/${listData.devices[0].id}`;
      const ownerHeaders = {
        cookie: `ssh_mcp_web_session=${token}`,
        origin: "http://127.0.0.1:3000",
        "x-ssh-mcp-dashboard": "1",
      };
      const policyResponse = captureResponse();
      await cp.handleHttp(
        jsonRequest("PATCH", deviceEndpoint, { policy: { profile: "operations" } }, ownerHeaders),
        policyResponse as unknown as ServerResponse,
        deviceEndpoint,
      );
      expect(policyResponse.statusCode).toBe(200);
      expect(JSON.parse(policyResponse.body).device.profile).toBe("operations");

      const revokeEndpoint = deviceEndpoint + "/revoke";
      const onlyRevokeResponse = captureResponse();
      await cp.handleHttp(
        request("POST", revokeEndpoint, ownerHeaders),
        onlyRevokeResponse as unknown as ServerResponse,
        revokeEndpoint,
      );
      expect(onlyRevokeResponse.statusCode).toBe(200);
      expect(JSON.parse(onlyRevokeResponse.body).device.status).toBe("revoked");
      expect(cp.store.getAgent(listData.devices[0].id)?.status).toBe("revoked");
      const revokedEventCount = cp.store
        .listAudit(meData.user.id, undefined, 20)
        .filter((event) => event.eventType === "agent_revoked").length;
      const repeatedRevokeResponse = captureResponse();
      await cp.handleHttp(
        request("POST", revokeEndpoint, ownerHeaders),
        repeatedRevokeResponse as unknown as ServerResponse,
        revokeEndpoint,
      );
      expect(repeatedRevokeResponse.statusCode).toBe(200);
      expect(
        cp.store
          .listAudit(meData.user.id, undefined, 20)
          .filter((event) => event.eventType === "agent_revoked"),
      ).toHaveLength(revokedEventCount);

      // 6. Remove device: permanently discard inventory and enrollment data.
      const originalEnrollmentHash = hashSecret(enrollData.enrollment_token);
      expect(cp.store.getEnrollmentTokenByHash(originalEnrollmentHash)).toBeDefined();
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
      expect(JSON.parse(revokeRes.body)).toMatchObject({
        removed: true,
        agent_id: listData.devices[0].id,
      });
      expect(cp.store.getAgent(listData.devices[0].id)).toBeUndefined();
      expect(cp.store.getEnrollmentTokenByHash(originalEnrollmentHash)).toBeUndefined();
      const listedAgain = captureResponse();
      await cp.handleHttp(
        request("GET", "/api/dashboard/devices", { cookie: `ssh_mcp_web_session=${token}` }),
        listedAgain as unknown as ServerResponse,
        "/api/dashboard/devices",
      );
      expect(JSON.parse(listedAgain.body).devices).toEqual([]);
      expect(
        cp.store.listAudit(meData.user.id, undefined, 20).map((event) => event.eventType),
      ).toEqual(expect.arrayContaining(["agent_revoked", "agent_removed"]));

      const reenroll = captureResponse();
      await cp.handleHttp(
        jsonRequest(
          "POST",
          "/api/dashboard/devices/enroll",
          { alias: "test-vps", requested_profile: "read-only" },
          {
            cookie: `ssh_mcp_web_session=${token}`,
            origin: "http://127.0.0.1:3000",
            "x-ssh-mcp-dashboard": "1",
          },
        ),
        reenroll as unknown as ServerResponse,
        "/api/dashboard/devices/enroll",
      );
      expect(reenroll.statusCode).toBe(201);
      expect(JSON.parse(reenroll.body).agent_id).not.toBe(listData.devices[0].id);

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
        ["POST", "/api/dashboard/devices/example/revoke"],
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
