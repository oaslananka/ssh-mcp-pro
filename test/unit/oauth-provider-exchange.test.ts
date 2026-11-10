import { afterEach, describe, expect, test, vi } from "vitest";
import {
  exchangeGitHubIdentity,
  exchangeGoogleIdentity,
  requestGoogleOAuthToken,
} from "../../src/remote/oauth-provider-exchange.js";
import { fetchGitHubUserDirect } from "../../src/remote/web-dashboard-oauth-users.js";
import type { RemoteConfig } from "../../src/remote/types.js";

afterEach(() => vi.unstubAllGlobals());

const githubConfig = {
  githubClientId: "fixture-client",
  githubClientSecret: "fixture-secret",
  githubCallbackUrl: "https://example.test/oauth/callback/github",
} as RemoteConfig;

const googleConfig = {
  googleClientId: "fixture-client",
  googleClientSecret: "fixture-secret",
  googleCallbackUrl: "https://example.test/oauth/callback/google",
} as RemoteConfig;

describe("provider authorization-code identity exchange", () => {
  test("returns valid GitHub identity without exposing access token", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: "provider-token" }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 1234, login: "fixture-user" }) });
    vi.stubGlobal("fetch", mock);

    await expect(exchangeGitHubIdentity(githubConfig, "code-123")).resolves.toEqual({
      id: "1234",
      login: "fixture-user",
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0]?.[0]).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.parse(mock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      code: "code-123",
      client_id: "fixture-client",
    });
    expect(mock.mock.calls[1]?.[1]?.headers.Authorization).toBe("Bearer provider-token");
  });

  test("rejects malformed GitHub identity before persistence", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: "provider-token" }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 12.5, login: "user" }) });
    vi.stubGlobal("fetch", mock);
    await expect(exchangeGitHubIdentity(githubConfig, "code")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
      status: 502,
    });
  });

  test("validates Google configuration before sending a request", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(exchangeGoogleIdentity({} as RemoteConfig, "code")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 503,
    });
    expect(mock).not.toHaveBeenCalled();
  });

  test("returns validated Google identity with optional picture", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: "provider-token" }) })
      .mockResolvedValueOnce({
        json: async () => ({ sub: "google-user", email: "user@example.test", name: "User" }),
      });
    vi.stubGlobal("fetch", mock);
    await expect(exchangeGoogleIdentity(googleConfig, "code")).resolves.toEqual({
      id: "google-user",
      email: "user@example.test",
      name: "User",
      picture: undefined,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
    expect(mock.mock.calls[1]?.[1]?.headers.Authorization).toBe("Bearer provider-token");
  });

  test("web dashboard GitHub sign-in uses its own registered callback URL", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: "dashboard-token" }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 987, login: "dashboard-user" }) });
    vi.stubGlobal("fetch", mock);
    await expect(
      fetchGitHubUserDirect(
        { ...githubConfig, publicBaseUrl: "https://dashboard.example.test" },
        "dashboard-code",
      ),
    ).resolves.toEqual({ id: "987", login: "dashboard-user" });
    const requestBody = JSON.parse(mock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.redirect_uri).toBe("https://dashboard.example.test/auth/callback/github");
    expect(requestBody.code).toBe("dashboard-code");
  });

  test("shared Google exchange preserves the caller's callback and response status", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ id_token: "provider-test-token" }),
    });
    vi.stubGlobal("fetch", mock);
    await expect(
      requestGoogleOAuthToken(
        googleConfig,
        "dashboard-code",
        "https://dashboard.example.test/auth/callback/google",
      ),
    ).resolves.toEqual({
      responseOk: false,
      tokenPayload: { id_token: "provider-test-token" },
    });
    const body = new URLSearchParams(mock.mock.calls[0]?.[1]?.body as string);
    expect(body.get("redirect_uri")).toBe("https://dashboard.example.test/auth/callback/google");
    expect(body.get("grant_type")).toBe("authorization_code");
  });
  test("rejects a Google token response without an access token", async () => {
    const mock = vi.fn().mockResolvedValue({ json: async () => ({ error: "invalid_grant" }) });
    vi.stubGlobal("fetch", mock);
    await expect(exchangeGoogleIdentity(googleConfig, "bad-code")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
      status: 502,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
