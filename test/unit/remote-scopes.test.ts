import { describe, expect, test } from "vitest";
import {
  allRemoteScopes,
  capabilitiesFromScopes,
  hasCapability,
  parseScopes,
} from "../../src/remote/scopes.js";
import { PUBLIC_REMOTE_SCOPES } from "../../src/remote/types.js";

describe("remote scope helpers", () => {
  test("parses only supported OAuth scopes", () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes("hosts:read unknown agents:admin")).toEqual(["hosts:read", "agents:admin"]);
  });

  test("new OAuth clients see generic device permissions, while legacy scopes still parse", () => {
    expect(PUBLIC_REMOTE_SCOPES).not.toContain("docker:manage");
    expect(PUBLIC_REMOTE_SCOPES).toContain("files:read");
    expect(PUBLIC_REMOTE_SCOPES).toContain("files:write");
    expect(PUBLIC_REMOTE_SCOPES).toContain("shell:exec");
    expect(parseScopes("docker:manage")).toEqual(["docker:manage"]);
  });

  test("maps scopes to de-duplicated capabilities", () => {
    const capabilities = capabilitiesFromScopes(["agents:admin", "files:read"]);

    expect(capabilities).toContain("agent.admin");
    expect(capabilities).toContain("audit.read");
    expect(capabilities).toContain("files.read");
    expect(hasCapability(capabilities, "agent.admin")).toBe(true);
    expect(hasCapability(capabilities, "sudo.exec")).toBe(false);
    expect(allRemoteScopes()).toContain("hosts:read");
  });
});
