import { describe, expect, test } from "vitest";
import { compareAgentVersion } from "../../src/remote/package-version.js";

describe("installed agent version comparison", () => {
  test.each([
    ["1.9.0", "1.10.0", "older_than_server"],
    ["1.10.0", "1.10.0", "same_as_server"],
    ["2.0.0", "1.99.99", "newer_than_server"],
    ["unknown", "1.0.0", "unknown"],
    ["1.0.0-beta.1", "1.0.0", "unknown"],
    ["1.0.0", "unknown", "unknown"],
    ["01.0.0", "1.0.0", "unknown"],
    ["1.0", "1.0.0", "unknown"],
  ])("compares %s to %s as %s", (agent, server, expected) => {
    expect(compareAgentVersion(agent, server)).toBe(expected);
  });
});
