import { describe, expect, test } from "vitest";
import { startLocalBrowserEnrollment } from "../../src/remote/agent-browser-enrollment.js";

const fixtureEnrollmentToken = `enr_${"x".repeat(43)}`;
const origin = "https://example.test";

describe("same-device browser enrollment handshake", () => {
  test("accepts a single authorized same-origin browser handoff without exposing its token in the link", async () => {
    const accepted: string[] = [];
    const session = await startLocalBrowserEnrollment(
      origin,
      "dev-laptop",
      async (token) => {
        accepted.push(token);
      },
      { timeoutMs: 5_000 },
    );
    try {
      const verify = new URL(session.verificationUrl);
      expect(verify.origin).toBe(origin);
      expect(verify.searchParams.get("local_enroll_port")).toBe(String(session.port));
      const state = verify.searchParams.get("local_enroll_state") ?? "";
      expect(state).toMatch(/^[a-zA-Z0-9_-]{43}$/u);
      expect(verify.href).not.toContain(fixtureEnrollmentToken);

      const ready = await fetch(`http://127.0.0.1:${session.port}/ready`, {
        method: "GET",
        headers: { Origin: origin },
      });
      expect(ready.status).toBe(204);
      expect(ready.headers.get("access-control-allow-origin")).toBe(origin);

      const noReadyFromOtherOrigin = await fetch(`http://127.0.0.1:${session.port}/ready`, {
        method: "GET",
        headers: { Origin: "https://evil.example" },
      });
      expect(noReadyFromOtherOrigin.status).toBe(403);

      const preflight = await fetch(session.callbackUrl, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);

      const blocked = await fetch(session.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ state, token: fixtureEnrollmentToken }),
      });
      expect(blocked.status).toBe(403);
      expect(accepted).toHaveLength(0);

      const wrongState = await fetch(session.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({
          state: "wrong",
          token: fixtureEnrollmentToken,
        }),
      });
      expect(wrongState.status).toBe(403);
      expect(accepted).toHaveLength(0);

      const ok = await fetch(session.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ state, token: fixtureEnrollmentToken }),
      });
      expect(ok.status).toBe(200);
      await session.finished;
      expect(accepted).toEqual([fixtureEnrollmentToken]);
    } finally {
      session.close();
    }
  });

  test("rejects malformed callback bodies and non-browser requests", async () => {
    const accepted: string[] = [];
    const session = await startLocalBrowserEnrollment(
      origin,
      "dev-laptop",
      async (token) => {
        accepted.push(token);
      },
      { timeoutMs: 5_000 },
    );
    try {
      const state = new URL(session.verificationUrl).searchParams.get("local_enroll_state");
      const request = (headers: Record<string, string>, body: string) =>
        fetch(session.callbackUrl, { method: "POST", headers, body });
      expect(
        (await request({ Origin: origin, "Content-Type": "application/json" }, "{")).status,
      ).toBe(400);
      expect(
        (
          await request(
            { "Content-Type": "application/json" },
            JSON.stringify({ state, token: "secret" }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            { Origin: origin, "Content-Type": "application/json" },
            JSON.stringify({ state, token: "" }),
          )
        ).status,
      ).toBe(400);
      expect(accepted).toHaveLength(0);
    } finally {
      session.close();
    }
  });

  test("rejects untrusted public-server URLs before opening the loopback listener", async () => {
    await expect(
      startLocalBrowserEnrollment("http://example.test", "bad", async () => {}),
    ).rejects.toThrow(/HTTPS/u);
    await expect(
      startLocalBrowserEnrollment("https://bad@example.test", "bad", async () => {}),
    ).rejects.toThrow(/HTTPS/u);
    await expect(
      startLocalBrowserEnrollment("https://example.test/?secret=abc", "bad", async () => {}),
    ).rejects.toThrow(/HTTPS/u);
  });

  test("fails closed when user never approves the browser handoff", async () => {
    const session = await startLocalBrowserEnrollment(origin, "dev-laptop", async () => {}, {
      timeoutMs: 80,
    });
    await expect(session.finished).rejects.toThrow(/expired/i);
  });
});
