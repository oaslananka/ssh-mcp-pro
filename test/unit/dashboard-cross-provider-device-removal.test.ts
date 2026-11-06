import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, test, vi } from "vitest";
import { RemoteControlPlane } from "../../src/remote/control-plane.js";
import { renderDashboardHtml } from "../../src/remote/web-dashboard-html.js";
import { hashSecret } from "../../src/remote/crypto.js";
import {
  captureResponse,
  jsonRequest,
  request,
  testConfig,
} from "../helpers/web-dashboard-fixture.js";

describe("GitHub and Google dashboard device ownership", () => {
  test("dashboard device buttons use the supported scoped API routes", () => {
    const html = renderDashboardHtml(
      Buffer.from("null", "utf8").toString("base64"),
      JSON.stringify("https://mcp.example.invalid/mcp"),
      JSON.stringify("https://mcp.example.invalid"),
    );
    expect(html).toContain("async function changePolicy(id, profile)");
    expect(html).toContain("async function revokeDevice(id)");
    expect(html).toContain("async function removeDevice(id)");
    expect(html).toContain('onclick="revokeDevice(');
    expect(html).toContain("Revoke access");
    expect(html).toContain("fetch('/api/dashboard/devices/' + encodeURIComponent(id), {");
    expect(html).toContain(
      "fetch('/api/dashboard/devices/' + encodeURIComponent(id) + '/revoke', {",
    );
    expect(html).not.toContain(" + id + '/policy'");
  });

  test("keeps colliding provider subject IDs separate through removal and audit", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ssh-mcp-provider-tenant-"));
    const config = testConfig(dir);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "tenant-test", alg: "RS256", use: "sig" };
    let googleIdToken = "";
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const target = String(input);
      if (target === "https://www.googleapis.com/oauth2/v3/certs") {
        return Response.json({ keys: [jwk] });
      }
      if (target === "https://oauth2.googleapis.com/token") {
        return Response.json({ id_token: googleIdToken });
      }
      if (target === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "disposable-github-test-token" });
      }
      if (target === "https://api.github.com/user") {
        return Response.json({ id: 420, login: "github-test-account" });
      }
      throw new Error("Unexpected provider request in isolated OAuth acceptance");
    });
    vi.stubGlobal("fetch", mockFetch);
    const controlPlane = new RemoteControlPlane(config);
    await controlPlane.initialize();
    try {
      async function login(provider: "github" | "google") {
        const loginPath = "/auth/login/" + provider;
        const authorize = captureResponse();
        await controlPlane.handleHttp(
          request("GET", loginPath),
          authorize as unknown as ServerResponse,
          loginPath,
        );
        expect(authorize.statusCode).toBe(302);
        const location = new URL(String(authorize.getHeader("location")));
        const state = location.searchParams.get("state");
        expect(state).toBeTruthy();
        const cookie = String(authorize.getHeader("set-cookie")).split(";")[0]!;
        expect(cookie).toBe("ssh_mcp_web_tx=" + state);
        if (provider === "google") {
          const nonce = location.searchParams.get("nonce");
          expect(nonce).toBeTruthy();
          googleIdToken = await new SignJWT({
            email: "same-human@example.invalid",
            email_verified: true,
            name: "Same Human",
            nonce,
          })
            .setProtectedHeader({ alg: "RS256", kid: "tenant-test" })
            // Deliberately collides with numeric GitHub ID 420.
            .setSubject("420")
            .setIssuer("https://accounts.google.com")
            .setAudience("test-google-client")
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey);
        }
        const callbackPath =
          provider === "github" ? "/auth/callback/github" : "/oauth/callback/google";
        const callback = captureResponse();
        await controlPlane.handleHttp(
          request(
            "GET",
            callbackPath + "?state=" + encodeURIComponent(state!) + "&code=disposable-code",
            { cookie },
          ),
          callback as unknown as ServerResponse,
          callbackPath,
        );
        expect(callback.statusCode).toBe(302);
        const cookies = callback.getHeader("set-cookie");
        expect(Array.isArray(cookies)).toBe(true);
        const sessionCookie = (cookies as string[])[0]!.split(";")[0]!;
        expect(sessionCookie).toMatch(/^ssh_mcp_web_session=[A-Za-z0-9_-]{43}$/u);
        const me = captureResponse();
        await controlPlane.handleHttp(
          request("GET", "/api/dashboard/me", { cookie: sessionCookie }),
          me as unknown as ServerResponse,
          "/api/dashboard/me",
        );
        expect(me.statusCode).toBe(200);
        const identity = JSON.parse(me.body) as {
          user: { id: string; provider: string; email?: string };
        };
        expect(identity.user.provider).toBe(provider);
        return { cookie: sessionCookie, userId: identity.user.id };
      }

      const github = await login("github");
      const google = await login("google");
      expect(github.userId).toBe("github:420");
      expect(google.userId).toBe("google:420");
      expect(github.userId).not.toBe(google.userId);

      const mutationHeaders = {
        origin: "http://127.0.0.1:3000",
        "x-ssh-mcp-dashboard": "1",
        "sec-fetch-site": "same-origin",
      };
      async function enroll(cookie: string, alias: string) {
        const endpoint = "/api/dashboard/devices/enroll";
        const response = captureResponse();
        await controlPlane.handleHttp(
          jsonRequest(
            "POST",
            endpoint,
            { alias, requested_profile: "read-only" },
            { cookie, ...mutationHeaders },
          ),
          response as unknown as ServerResponse,
          endpoint,
        );
        expect(response.statusCode).toBe(201);
        const data = JSON.parse(response.body) as {
          agent_id: string;
          enrollment_token: string;
        };
        expect(
          controlPlane.store.getEnrollmentTokenByHash(hashSecret(data.enrollment_token)),
        ).toBeDefined();
        return data;
      }

      const githubDevice = await enroll(github.cookie, "shared-device-name");
      const googleDevice = await enroll(google.cookie, "shared-device-name");
      expect(githubDevice.agent_id).not.toBe(googleDevice.agent_id);

      for (const [owner, ownDevice, foreignDevice] of [
        [github, githubDevice, googleDevice],
        [google, googleDevice, githubDevice],
      ] as const) {
        const list = captureResponse();
        await controlPlane.handleHttp(
          request("GET", "/api/dashboard/devices", { cookie: owner.cookie }),
          list as unknown as ServerResponse,
          "/api/dashboard/devices",
        );
        expect(list.statusCode).toBe(200);
        expect(JSON.parse(list.body).devices).toEqual([
          expect.objectContaining({ id: ownDevice.agent_id, alias: "shared-device-name" }),
        ]);
        const endpoint = "/api/dashboard/devices/" + foreignDevice.agent_id;
        for (const [method, target] of [
          ["PATCH", endpoint],
          ["DELETE", endpoint],
          ["POST", endpoint + "/revoke"],
        ] as const) {
          const attempt = captureResponse();
          await controlPlane.handleHttp(
            jsonRequest(
              method,
              target,
              { policy: { profile: "full-admin" } },
              { cookie: owner.cookie, ...mutationHeaders },
            ),
            attempt as unknown as ServerResponse,
            target,
          );
          expect(attempt.statusCode).toBe(404);
        }
        expect(controlPlane.store.getAgent(foreignDevice.agent_id)).toBeDefined();
      }

      const googleEndpoint = "/api/dashboard/devices/" + googleDevice.agent_id;
      const revokeEndpoint = googleEndpoint + "/revoke";
      const revoked = captureResponse();
      await controlPlane.handleHttp(
        request("POST", revokeEndpoint, { cookie: google.cookie, ...mutationHeaders }),
        revoked as unknown as ServerResponse,
        revokeEndpoint,
      );
      expect(revoked.statusCode).toBe(200);
      expect(JSON.parse(revoked.body).device.status).toBe("revoked");
      expect(controlPlane.store.getAgent(googleDevice.agent_id)?.status).toBe("revoked");
      // Revocation must not erase the device or its one-time enrollment record.
      expect(
        controlPlane.store.getEnrollmentTokenByHash(hashSecret(googleDevice.enrollment_token)),
      ).toBeDefined();
      expect(controlPlane.store.getAgent(githubDevice.agent_id)).toBeDefined();
      const removed = captureResponse();
      await controlPlane.handleHttp(
        request("DELETE", googleEndpoint, { cookie: google.cookie, ...mutationHeaders }),
        removed as unknown as ServerResponse,
        googleEndpoint,
      );
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toMatchObject({
        removed: true,
        agent_id: googleDevice.agent_id,
      });
      expect(controlPlane.store.getAgent(googleDevice.agent_id)).toBeUndefined();
      expect(
        controlPlane.store.getEnrollmentTokenByHash(hashSecret(googleDevice.enrollment_token)),
      ).toBeUndefined();
      expect(controlPlane.store.getAgent(githubDevice.agent_id)).toBeDefined();
      expect(
        controlPlane.store.getEnrollmentTokenByHash(hashSecret(githubDevice.enrollment_token)),
      ).toBeDefined();

      const googleAudit = controlPlane.store.listAudit(google.userId, undefined, 50);
      expect(googleAudit.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["agent_revoked", "agent_removed"]),
      );
      const githubAudit = controlPlane.store.listAudit(github.userId, undefined, 50);
      expect(githubAudit.every((event) => event.agentId !== googleDevice.agent_id)).toBe(true);

      const duplicateRemoval = captureResponse();
      await controlPlane.handleHttp(
        request("DELETE", googleEndpoint, { cookie: google.cookie, ...mutationHeaders }),
        duplicateRemoval as unknown as ServerResponse,
        googleEndpoint,
      );
      expect(duplicateRemoval.statusCode).toBe(404);
      const reenrolled = await enroll(google.cookie, "shared-device-name");
      expect(reenrolled.agent_id).not.toBe(googleDevice.agent_id);
    } finally {
      controlPlane.close();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });
});
