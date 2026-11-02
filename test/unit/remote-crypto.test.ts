import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  ensurePemKeyPair,
  generateEd25519PemKeyPair,
  hashSecret,
  issueAccessToken,
  keyId,
  loadJwtKeyPair,
  publicJwkFromPem,
  safeSecretEqual,
  signEnvelope,
  verifyEnvelope,
  verifyRemoteAccessToken,
} from "../../src/remote/crypto.js";
import type { RemoteConfig } from "../../src/remote/types.js";

function testConfig(dir: string): RemoteConfig {
  return {
    enabled: true,
    publicBaseUrl: "http://localhost:3000",
    mcpResourceUrl: "http://localhost:3000/mcp",
    databaseUrl: ":memory:",
    githubCallbackUrl: "http://localhost:3000/oauth/callback/github",
    allowAllUsers: true,
    allowedGitHubLogins: [],
    allowedGitHubIds: [],
    accessTokenTtlSeconds: 900,
    authCodeTtlSeconds: 300,
    enrollmentTokenTtlSeconds: 600,
    controlPlaneSigningKeyPath: path.join(dir, "control-plane.json"),
    jwtSigningKeyPath: path.join(dir, "jwt.json"),
    agentWsPath: "/api/agents/connect",
    maxActionTimeoutSeconds: 120,
    maxOutputBytes: 200_000,
    maxOAuthClients: 100,
  };
}

describe("remote crypto helpers", () => {
  test("canonical JSON preserves nested key ordering for signed payloads", () => {
    const payload = {
      z: 1,
      nested: { b: true, a: 'quoted "value"' },
      a: [3, { y: null, x: "ok" }],
    };
    const expected = JSON.stringify({
      a: [3, { x: "ok", y: null }],
      nested: { a: 'quoted "value"', b: true },
      z: 1,
    });
    expect(canonicalJson(payload)).toBe(expected);
  });

  test("canonical JSON sorts keys by code-unit order independently of locale", () => {
    const payload = { z: 1, ä: 2, A: 3, a: 4 };
    expect(canonicalJson(payload)).toBe('{"A":3,"a":4,"z":1,"ä":2}');
  });

  test("hashes and compares secrets without storing plaintext", () => {
    const hash = hashSecret("one-time-token");

    expect(hash).not.toContain("one-time-token");
    expect(safeSecretEqual("one-time-token", hash)).toBe(true);
    expect(safeSecretEqual("wrong-token", hash)).toBe(false);
    expect(safeSecretEqual("one-time-token", "short-hash")).toBe(false);
  });

  test("loads existing Ed25519 key pairs and exports public JWKS metadata", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-pem-"));
    const keyPath = path.join(dir, "agent.json");
    const first = ensurePemKeyPair(keyPath);
    const second = ensurePemKeyPair(keyPath);
    const jwk = await publicJwkFromPem(first.publicKeyPem);

    expect(second).toEqual(first);
    expect(jwk.kty).toBe("OKP");
    expect(jwk.use).toBe("sig");
    expect(jwk.alg).toBe("EdDSA");
    expect(jwk.kid).toBe(keyId(first.publicKeyPem));
  });

  test("does not overwrite corrupt key files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-corrupt-key-"));
    const keyPath = path.join(dir, "agent.json");
    writeFileSync(keyPath, "{not-json", { mode: 0o600 });

    expect(() => ensurePemKeyPair(keyPath)).toThrow();
  });

  test("signs action envelopes and rejects tampering", () => {
    const keyPair = generateEd25519PemKeyPair();
    const envelope = {
      type: "action.request",
      action_id: "act_test",
      agent_id: "agt_test",
      nonce: "nonce",
      signature: "",
    };
    const signed = { ...envelope, signature: signEnvelope(envelope, keyPair.privateKeyPem) };

    expect(verifyEnvelope(signed, keyPair.publicKeyPem)).toBe(true);
    expect(verifyEnvelope({ ...signed, nonce: "changed" }, keyPair.publicKeyPem)).toBe(false);
    expect(verifyEnvelope({ ...signed, signature: "" }, keyPair.publicKeyPem)).toBe(false);
  });

  test("issues and verifies scoped JWT access tokens", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-crypto-"));
    const config = testConfig(dir);
    const keyPair = await loadJwtKeyPair(config.jwtSigningKeyPath);
    const token = await issueAccessToken(
      config,
      keyPair,
      { id: "github:169144131", githubId: "169144131", githubLogin: "oaslananka" },
      ["hosts:read", "agents:read", "status:read"],
    );

    const principal = await verifyRemoteAccessToken(`Bearer ${token.token}`, config, keyPair);

    expect(principal.userId).toBe("github:169144131");
    expect(principal.githubLogin).toBe("oaslananka");
    expect(principal.scopes).toEqual(["hosts:read", "agents:read", "status:read"]);
    expect(principal.capabilities).toEqual(
      expect.arrayContaining(["hosts.read", "agents.read", "system.read"]),
    );
  });

  test("rejects non-scalar GitHub identity claims in signed JWTs", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-identity-claims-"));
    const config = testConfig(dir);
    const keyPair = await loadJwtKeyPair(config.jwtSigningKeyPath);
    const token = await new SignJWT({
      scope: "hosts:read",
      github_id: { nested: "invalid" },
      github_login: "valid-login",
    })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer(config.publicBaseUrl)
      .setAudience(config.mcpResourceUrl)
      .setSubject("github:123")
      .setJti("test-claims")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keyPair.privateKey);
    await expect(verifyRemoteAccessToken("Bearer " + token, config, keyPair)).rejects.toThrow(
      "Invalid GitHub identity claims",
    );
  });

  test("rejects missing remote bearer tokens", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sshautomator-token-"));
    const config = testConfig(dir);
    const keyPair = await loadJwtKeyPair(config.jwtSigningKeyPath);

    await expect(verifyRemoteAccessToken(undefined, config, keyPair)).rejects.toThrow(
      "Missing bearer token",
    );
  });
});
