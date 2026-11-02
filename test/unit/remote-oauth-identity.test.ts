import { afterEach, describe, expect, test, vi } from "vitest";
import { OAuthHandler } from "../../src/remote/oauth-handler.js";

afterEach(() => vi.unstubAllGlobals());

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
