import { describe, expect, test } from "@jest/globals";
import {
  allRemoteScopes,
  capabilitiesFromScopes,
  hasCapability,
  parseScopes,
} from "../../src/remote/scopes.js";

describe("remote scope helpers", () => {
  test("parses only supported OAuth scopes", () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes("hosts:read unknown agents:admin")).toEqual(["hosts:read", "agents:admin"]);
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
