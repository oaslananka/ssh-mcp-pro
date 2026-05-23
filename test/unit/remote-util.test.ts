import { describe, expect, test } from "@jest/globals";
import { formDecode, userSafeError } from "../../src/remote/util.js";

describe("remote utility helpers", () => {
  test("rejects duplicate form fields instead of silently overwriting", () => {
    expect(() => formDecode("code=first&code=second")).toThrow("Duplicate form parameter");
  });

  test("decodes unique form fields", () => {
    expect(formDecode("grant_type=authorization_code&code=abc")).toEqual({
      grant_type: "authorization_code",
      code: "abc",
    });
  });

  test("formats plain safe error objects with code and message", () => {
    expect(userSafeError({ code: "INVALID_TOKEN", message: "Authorization failed" })).toBe(
      "INVALID_TOKEN: Authorization failed",
    );
  });
});
