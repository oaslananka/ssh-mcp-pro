import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { loadRemoteConfig } from "../../src/remote/config.js";

const SAVED_ENV = { ...process.env };

function resetRemoteEnv(): void {
  process.env = { ...SAVED_ENV };
  delete process.env.SSH_MCP_REMOTE_AGENT_CONTROL_PLANE;
  delete process.env.SSHAUTOMATOR_REMOTE_AGENT_CONTROL_PLANE;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.MCP_RESOURCE_URL;
  delete process.env.AUTH_ALLOWED_GITHUB_LOGINS;
  delete process.env.AUTH_ALLOWED_GITHUB_IDS;
  delete process.env.ACCESS_TOKEN_TTL_SECONDS;
}

describe("loadRemoteConfig", () => {
  beforeEach(() => {
    resetRemoteEnv();
  });

  afterAll(() => {
    process.env = SAVED_ENV;
  });

  test("enables the remote control plane with the ssh-mcp env name", () => {
    process.env.SSH_MCP_REMOTE_AGENT_CONTROL_PLANE = "true";

    expect(loadRemoteConfig().enabled).toBe(true);
  });

  test("keeps the legacy remote control plane env name as a fallback", () => {
    process.env.SSHAUTOMATOR_REMOTE_AGENT_CONTROL_PLANE = "true";

    expect(loadRemoteConfig().enabled).toBe(true);
  });

  test("prefers the ssh-mcp env name when both names are present", () => {
    process.env.SSH_MCP_REMOTE_AGENT_CONTROL_PLANE = "false";
    process.env.SSHAUTOMATOR_REMOTE_AGENT_CONTROL_PLANE = "true";

    expect(loadRemoteConfig().enabled).toBe(false);
  });

  test("normalizes URLs, list env vars, and invalid integer fallbacks", () => {
    process.env.PUBLIC_BASE_URL = "https://remote.example/";
    process.env.AUTH_ALLOWED_GITHUB_LOGINS = "alice,bob\ncarol";
    process.env.AUTH_ALLOWED_GITHUB_IDS = " 1,\n2 ";
    process.env.ACCESS_TOKEN_TTL_SECONDS = "not-a-number";

    expect(loadRemoteConfig()).toEqual(
      expect.objectContaining({
        publicBaseUrl: "https://remote.example",
        mcpResourceUrl: "https://remote.example/mcp",
        githubCallbackUrl: "https://remote.example/oauth/callback/github",
        allowedGitHubLogins: ["alice", "bob", "carol"],
        allowedGitHubIds: ["1", "2"],
        accessTokenTtlSeconds: 900,
      }),
    );
  });

  test("parses explicit numeric limits and resource URL overrides", () => {
    process.env.MCP_RESOURCE_URL = "https://mcp.example/resource";
    process.env.ACCESS_TOKEN_TTL_SECONDS = "1200";

    expect(loadRemoteConfig()).toEqual(
      expect.objectContaining({
        mcpResourceUrl: "https://mcp.example/resource",
        accessTokenTtlSeconds: 1200,
      }),
    );
  });
});
