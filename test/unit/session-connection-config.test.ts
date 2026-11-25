import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  SessionConnectionConfig,
  translateSshConnectionError,
} from "../../src/session-connection-config.js";
import { knownHostKeyFingerprints } from "../../src/session-auth.js";
import { createPolicyError } from "../../src/errors.js";
import { ErrorCode, type ConnectionParams } from "../../src/types.js";

const params: ConnectionParams = {
  host: "fixture.example.test",
  username: "fixture",
  auth: "password",
  password: "fixture-only",
};
const security = {
  allowRootLogin: false,
  hostKeyPolicy: "strict" as const,
  knownHostsPath: "",
  allowedCiphers: [] as string[],
};

describe("SSH session connection configuration", () => {
  test("preserves default port, timeout, authentication and cipher overrides", async () => {
    const builder = new SessionConnectionConfig();
    const config = await builder.build(
      params,
      { ...security, allowedCiphers: ["aes256-ctr"] },
      "strict",
    );
    expect(config).toMatchObject({
      host: params.host,
      username: params.username,
      port: 22,
      readyTimeout: 20000,
      password: params.password,
      algorithms: { cipher: ["aes256-ctr"] },
      hostHash: "sha256",
    });
    expect((config.hostVerifier as (hash: string) => boolean)("unknown")).toBe(false);
    const custom = await builder.build(
      { ...params, port: 2200, readyTimeoutMs: 3000 },
      security,
      "strict",
    );
    expect(custom).toMatchObject({ port: 2200, readyTimeout: 3000 });
  });

  test("resolves explicit policy before legacy flag and configured default", () => {
    const builder = new SessionConnectionConfig();
    expect(
      builder.resolveHostKeyPolicy(
        { ...params, hostKeyPolicy: "accept-new", strictHostKeyChecking: false },
        "strict",
      ),
    ).toBe("accept-new");
    expect(
      builder.resolveHostKeyPolicy({ ...params, strictHostKeyChecking: false }, "strict"),
    ).toBe("insecure");
    expect(
      builder.resolveHostKeyPolicy({ ...params, strictHostKeyChecking: true }, "accept-new"),
    ).toBe("strict");
    expect(builder.resolveHostKeyPolicy(params, "accept-new")).toBe("accept-new");
  });

  test("preserves explicit fingerprint precedence", async () => {
    const builder = new SessionConnectionConfig();
    const config = await builder.build(
      { ...params, expectedHostKeySha256: "SHA256:fixture" },
      security,
      "insecure",
    );
    const verify = config.hostVerifier as (hash: string) => boolean;
    expect(verify("fixture")).toBe(true);
    expect(verify("different")).toBe(false);
  });

  test("accept-new caches first-seen keys per host and port within one builder", async () => {
    const first = new SessionConnectionConfig();
    const second = new SessionConnectionConfig();
    const verify = (await first.build(params, security, "accept-new")).hostVerifier as (
      hash: string,
    ) => boolean;
    expect(verify("first")).toBe(true);
    expect(verify("SHA256:first")).toBe(true);
    expect(verify("other")).toBe(false);
    const otherPort = (await first.build({ ...params, port: 2200 }, security, "accept-new"))
      .hostVerifier as (hash: string) => boolean;
    expect(otherPort("other")).toBe(true);
    const independent = (await second.build(params, security, "accept-new")).hostVerifier as (
      hash: string,
    ) => boolean;
    expect(independent("other")).toBe(true);
  });

  test("strict mode uses configured or explicit known_hosts and rejects revoked entries", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "session-connection-fixture-"));
    try {
      const file = path.join(dir, "known_hosts");
      const key = Buffer.from("synthetic-host-key").toString("base64");
      const fingerprint = knownHostKeyFingerprints(key)[0]!;
      writeFileSync(file, params.host + " ssh-ed25519 " + key + "\n");
      const builder = new SessionConnectionConfig();
      const config = await builder.build(params, { ...security, knownHostsPath: file }, "strict");
      const verify = config.hostVerifier as (hash: string) => boolean;
      expect(verify(fingerprint)).toBe(true);
      expect(verify("different")).toBe(false);
      writeFileSync(file, "@revoked " + params.host + " ssh-ed25519 " + key + "\n");
      expect(verify(fingerprint)).toBe(false);
      const explicit = await builder.build(
        { ...params, knownHostsPath: path.join(dir, "missing") },
        { ...security, knownHostsPath: file },
        "strict",
      );
      expect((explicit.hostVerifier as (hash: string) => boolean)(fingerprint)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves structured connection error mapping and existing errors", () => {
    const original = createPolicyError("fixture");
    expect(translateSshConnectionError(original)).toBe(original);
    expect(translateSshConnectionError(new Error("authentication failed")).code).toBe(
      ErrorCode.EAUTH,
    );
    expect(translateSshConnectionError(new Error("ETIMEDOUT")).code).toBe(ErrorCode.ETIMEOUT);
    expect(translateSshConnectionError(new Error("ECONNREFUSED")).code).toBe(ErrorCode.ECONN);
    expect(translateSshConnectionError(new Error("Host key mismatch")).code).toBe(
      ErrorCode.EHOSTKEY,
    );
    expect(translateSshConnectionError("unexpected").message).toBe(
      "Failed to establish SSH connection: unexpected",
    );
  });
});
