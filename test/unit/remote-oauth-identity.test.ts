import { afterEach, describe, expect, test, vi } from "vitest";
import { OAuthHandler } from "../../src/remote/oauth-handler.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GitHub OAuth user response validation", () => {
  test.each([
    { id: { nested: 1 }, login: "user" },
    { id: 12, login: ["user"] },
    { id: 12.4, login: "user" },
  ])("rejects malformed GitHub identities before persistence", async (user) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: "test-value" }) })
      .mockResolvedValueOnce({ json: async () => user });
    vi.stubGlobal("fetch", fetchMock);
    const handler = new OAuthHandler(
      {
        githubClientId: "client",
        githubClientSecret: "test-value",
        githubCallbackUrl: "http://localhost/callback",
      } as never,
      null as never,
      new Map(),
      () => {
        throw new Error("unexpected key access");
      },
      () => {
        throw new Error("unexpected audit");
      },
    );
    const method = handler as unknown as { fetchGitHubUser: (code: string) => Promise<unknown> };
    await expect(method.fetchGitHubUser("test-code")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("OAuth fixture identity boundary", () => {
  test.each([
    { mode: "production", base: "https://ssh-mcp-pro.example.test", expected: false },
    { mode: "production", base: "http://127.0.0.1:3000", expected: false },
    { mode: "test", base: "https://ssh-mcp-pro.example.test", expected: false },
    { mode: "test", base: "not-a-valid-URL", expected: false },
    { mode: "development", base: "http://127.0.0.1:3000", expected: false },
    { mode: "", base: "http://127.0.0.1:3000", expected: false },
    { mode: "test", base: "http://127.0.0.1:3000", expected: true },
  ])(
    "fixture identities enabled only on isolated test loopback: $mode $base",
    ({ mode, base, expected }) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("SSHAUTOMATOR_TEST_GITHUB_ID", "777");
      vi.stubEnv("SSHAUTOMATOR_TEST_GITHUB_LOGIN", "fixture-login");
      vi.stubEnv("SSHAUTOMATOR_TEST_GOOGLE_ID", "google-777");
      vi.stubEnv("SSHAUTOMATOR_TEST_GOOGLE_EMAIL", "fixture@example.test");
      const handler = new OAuthHandler(
        { publicBaseUrl: base } as never,
        null as never,
        new Map(),
        () => {
          throw new Error("unexpected key access");
        },
        () => {
          throw new Error("unexpected audit");
        },
      );
      expect(handler.testGitHubUser()).toEqual(
        expected ? { id: "777", login: "fixture-login" } : undefined,
      );
      expect(handler.testGoogleUser()).toEqual(
        expected
          ? { id: "google-777", email: "fixture@example.test", name: "Test Google User" }
          : undefined,
      );
    },
  );
});
