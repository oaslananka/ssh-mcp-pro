import { describe, expect, test } from "vitest";
import { buildSessionAuthConfig } from "../../src/session-auth-config.js";

const base = { host: "example.test", username: "operator" };

describe("SSH session authentication strategy", () => {
  test("preserves explicit password authentication", async () => {
    await expect(
      buildSessionAuthConfig({ ...base, auth: "password", password: "secret" }),
    ).resolves.toEqual({ password: "secret" });
    await expect(buildSessionAuthConfig({ ...base, auth: "password" })).rejects.toThrow(
      "Password required for password authentication",
    );
  });

  test("passes inline key and optional passphrase without changing them", async () => {
    await expect(
      buildSessionAuthConfig({
        ...base,
        auth: "key",
        privateKey: "fixture-key",
        passphrase: "fixture-passphrase",
      }),
    ).resolves.toEqual({
      privateKey: "fixture-key",
      passphrase: "fixture-passphrase",
    });
    await expect(
      buildSessionAuthConfig({ ...base, auth: "key", privateKey: "fixture-key" }),
    ).resolves.toEqual({ privateKey: "fixture-key" });
  });

  test("auto strategy prefers password over available private key", async () => {
    await expect(
      buildSessionAuthConfig({
        ...base,
        auth: "auto",
        password: "secret",
        privateKey: "fixture-key",
      }),
    ).resolves.toEqual({ password: "secret" });
  });

  test("defaults to auto and uses available inline key without password", async () => {
    await expect(buildSessionAuthConfig({ ...base, privateKey: "fixture-key" })).resolves.toEqual({
      privateKey: "fixture-key",
    });
  });
});
