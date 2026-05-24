import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { loadRemoteConfig } from "../../src/remote/config.js";

const SAVED_ENV = { ...process.env };

function resetRemoteEnv(): void {
  process.env = { ...SAVED_ENV };
  delete process.env.SSH_MCP_REMOTE_AGENT_CONTROL_PLANE;
  delete process.env.SSHAUTOMATOR_REMOTE_AGENT_CONTROL_PLANE;
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
});
