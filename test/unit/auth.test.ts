import { describe, expect, test } from "@jest/globals";
import {
  constantTimeTokenEquals,
  extractBearerToken,
  isBearerAuthorizationValid,
} from "../../src/auth.js";

describe("HTTP bearer authentication helpers", () => {
  test("compares bearer tokens with fixed-length digests", () => {
    expect(constantTimeTokenEquals("correct-token", "correct-token")).toBe(true);
    expect(constantTimeTokenEquals("wrong-token-1", "wrong-token-2")).toBe(false);
    expect(constantTimeTokenEquals("short", "correct-token")).toBe(false);
    expect(constantTimeTokenEquals("wrong-token-that-is-longer", "correct-token")).toBe(false);
    expect(constantTimeTokenEquals("anything", "")).toBe(false);
  });

  test("parses only the exact bearer authorization format", () => {
    expect(extractBearerToken("Bearer secret")).toBe("secret");
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken("Basic secret")).toBeUndefined();
    expect(extractBearerToken("Bearer")).toBeUndefined();
    expect(extractBearerToken("Bearer  secret")).toBeUndefined();
    expect(extractBearerToken("Bearer secret ")).toBeUndefined();
    expect(extractBearerToken(" Bearer secret")).toBeUndefined();
  });

  test("validates HTTP authorization through the constant-time helper path", () => {
    expect(isBearerAuthorizationValid("Bearer secret", "secret")).toBe(true);
    expect(isBearerAuthorizationValid("Bearer nopeee", "secret")).toBe(false);
    expect(isBearerAuthorizationValid("Bearer no", "secret")).toBe(false);
    expect(isBearerAuthorizationValid("Bearer much-longer-token", "secret")).toBe(false);
    expect(isBearerAuthorizationValid(undefined, "secret")).toBe(false);
    expect(isBearerAuthorizationValid("Basic secret", "secret")).toBe(false);
    expect(isBearerAuthorizationValid("Bearer secret", "")).toBe(false);
  });
});
