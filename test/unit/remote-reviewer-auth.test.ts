import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  isValidReviewerPasswordHash,
  verifyReviewerPassword,
} from "../../src/remote/reviewer-auth.js";

function passwordHash(password: string, salt = randomBytes(16)): string {
  const key = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

describe("OpenAI reviewer password verification", () => {
  test("accepts the configured scrypt encoding and verifies the correct password", async () => {
    const encoded = passwordHash("reviewer-password-that-is-not-for-production");

    expect(isValidReviewerPasswordHash(encoded)).toBe(true);
    await expect(
      verifyReviewerPassword("reviewer-password-that-is-not-for-production", encoded),
    ).resolves.toBe(true);
  });

  test("rejects a wrong password without revealing whether the username matched", async () => {
    const encoded = passwordHash("reviewer-password-that-is-not-for-production");

    await expect(verifyReviewerPassword("wrong-password", encoded)).resolves.toBe(false);
  });

  test.each([
    undefined,
    "",
    "scrypt$32768$8$1$c2FsdC1zYWx0$c29tZS1rZXk",
    "scrypt$16384$8$1$c2FsdA$c29tZS1rZXk",
    "scrypt$16384$8$1$%%%$%%%",
    "pbkdf2$16384$8$1$c2FsdC1zYWx0$c29tZS1rZXk",
  ])("fails closed for malformed or unsupported hash configuration: %s", async (encoded) => {
    expect(isValidReviewerPasswordHash(encoded)).toBe(false);
    await expect(verifyReviewerPassword("some-password", encoded ?? "")).resolves.toBe(false);
  });
});
