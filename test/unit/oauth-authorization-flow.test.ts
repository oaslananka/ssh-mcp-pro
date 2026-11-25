import type { ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import {
  OAuthAuthorizationFlow,
  type PendingAuthorize,
} from "../../src/remote/oauth-authorization-flow.js";
import { RemoteStore } from "../../src/remote/store.js";
import { ReviewerSessionHandler } from "../../src/remote/reviewer-session.js";
import { hashSecret } from "../../src/remote/crypto.js";
import {
  captureResponse,
  jsonRequest,
  request,
  testConfig,
} from "../helpers/web-dashboard-fixture.js";

describe("OAuth browser authorization boundary", () => {
  test("binds approval and single-use callback to the browser and narrows requested scopes", async () => {
    const config = testConfig(".");
    const store = new RemoteStore(":memory:");
    try {
      const pending = new Map<string, PendingAuthorize>();
      const user = { id: "81", login: "fixture-user" };
      const identity = {
        testGitHubUser: () => undefined,
        testGoogleUser: () => undefined,
        fetchGitHubUser: vi.fn(async () => user),
        fetchGoogleUser: vi.fn(async () => {
          throw new Error("Unexpected Google callback");
        }),
        upsertGitHubUser: (value: typeof user) => {
          store.upsertUser({ ...value, internalId: "github:81", now: new Date().toISOString() });
          return { id: "github:81" };
        },
        upsertGoogleUser: () => {
          throw new Error("Unexpected Google identity");
        },
      };
      const flow = new OAuthAuthorizationFlow(
        config,
        store,
        pending,
        new ReviewerSessionHandler(config, store),
        identity,
        () => {},
      );
      const redirectUri = "http://127.0.0.1:3001/callback";
      store.insertClient({
        id: "fixture-row",
        clientId: "fixture-client",
        clientName: "Fixture client",
        redirectUris: [redirectUri],
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        createdAt: new Date().toISOString(),
      });
      const authorize = new URL("/oauth/authorize", config.publicBaseUrl);
      authorize.search = new URLSearchParams({
        client_id: "fixture-client",
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: "fixture-challenge",
        code_challenge_method: "S256",
        state: "client-state",
        resource: config.mcpResourceUrl,
        scope: "hosts:read shell:exec",
      }).toString();
      const consent = captureResponse();
      await flow.handleAuthorize(
        request("GET", authorize.pathname + authorize.search),
        consent as unknown as ServerResponse,
      );
      expect(consent.statusCode).toBe(200);
      expect(consent.body).toContain("Read-only inspection (recommended)");
      const transaction = [...pending.keys()][0];
      if (!transaction) throw new Error("Missing authorization transaction");
      const cookie = "ssh_mcp_oauth_tx=" + transaction;
      expect(consent.getHeader("set-cookie")).toContain(cookie);
      const form = { transaction, provider: "github", grant_mode: "read_only" };
      await expect(
        flow.handleApprove(
          jsonRequest("POST", "/oauth/approve", form),
          captureResponse() as unknown as ServerResponse,
        ),
      ).rejects.toMatchObject({ code: "INVALID_TOKEN", status: 403 });
      const approval = captureResponse();
      await flow.handleApprove(
        jsonRequest("POST", "/oauth/approve", form, { cookie }),
        approval as unknown as ServerResponse,
      );
      expect(pending.get(transaction)).toMatchObject({ approved: true, scope: "hosts:read" });
      expect(approval.body).toContain("Continue with GitHub");
      const callback =
        "/oauth/callback/github?" +
        new URLSearchParams({ code: "fixture-code", state: transaction });
      const response = captureResponse();
      await flow.handleGitHubCallback(
        request("GET", callback, { cookie }),
        response as unknown as ServerResponse,
      );
      expect(pending.has(transaction)).toBe(false);
      expect(response.getHeader("set-cookie")).toContain("Max-Age=0");
      const href = /href="([^"]+)"/.exec(response.body)?.[1];
      if (!href) throw new Error("Missing callback link");
      const destination = new URL(href.replaceAll("&amp;", "&"));
      expect(destination.origin + destination.pathname).toBe(redirectUri);
      expect(destination.searchParams.get("state")).toBe("client-state");
      const code = destination.searchParams.get("code");
      if (!code) throw new Error("Missing authorization code");
      expect(store.getAuthorizationCodeByHash(hashSecret(code))).toMatchObject({
        userId: "github:81",
        clientId: "fixture-client",
        scope: "hosts:read",
        codeChallenge: "fixture-challenge",
        resource: config.mcpResourceUrl,
      });
      await expect(
        flow.handleGitHubCallback(
          request("GET", callback, { cookie }),
          captureResponse() as unknown as ServerResponse,
        ),
      ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
      expect(identity.fetchGitHubUser).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });
});
