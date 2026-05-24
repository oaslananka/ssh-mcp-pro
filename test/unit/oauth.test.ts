import { createSign, generateKeyPairSync, type JsonWebKey, type KeyLike } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import {
  isOAuthAuthorizationValid,
  normalizeOAuthError,
  verifyOAuthAuthorization,
} from "../../src/oauth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OAuth verification", () => {
  test("fails closed when OAuth configuration or bearer token is missing", async () => {
    await expect(
      verifyOAuthAuthorization("Bearer token", {
        requiredScopes: [],
      }),
    ).rejects.toThrow("OAuth issuer, audience, and JWKS URL are required");

    await expect(
      verifyOAuthAuthorization(undefined, {
        issuer: "https://auth.example",
        audience: "https://mcp.example/mcp",
        jwksUrl: "https://auth.example/.well-known/jwks.json?missing",
        requiredScopes: [],
      }),
    ).rejects.toThrow("Missing bearer token");

    await expect(
      isOAuthAuthorizationValid(undefined, {
        issuer: "https://auth.example",
        audience: "https://mcp.example/mcp",
        jwksUrl: "https://auth.example/.well-known/jwks.json?missing-valid",
        requiredScopes: [],
      }),
    ).resolves.toBe(false);
  });

  test("accepts a valid RS256 JWT with issuer audience and required scope", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        alg: "RS256",
        kid: "test-key",
        typ: "JWT",
      },
      {
        iss: "https://auth.example",
        aud: "https://mcp.example/mcp",
        exp: now + 300,
        iat: now,
        scope: "ssh-mcp-pro.read",
      },
      privateKey,
    );

    await expect(
      verifyOAuthAuthorization(`Bearer ${token}`, {
        issuer: "https://auth.example",
        audience: "https://mcp.example/mcp",
        jwksUrl: "https://auth.example/.well-known/jwks.json",
        requiredScopes: ["ssh-mcp-pro.read"],
      }),
    ).resolves.toEqual(expect.objectContaining({ iss: "https://auth.example" }));
  });

  test("accepts audience arrays and scp claim variants", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key-scp";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = Math.floor(Date.now() / 1000);
    const config = {
      issuer: "https://auth.example",
      audience: "https://mcp.example/mcp",
      jwksUrl: "https://auth.example/.well-known/jwks.json?scp",
      requiredScopes: ["ssh-mcp-pro.read", "ssh-mcp-pro.write"],
    };

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-scp" },
          {
            iss: "https://auth.example",
            aud: ["https://other.example", "https://mcp.example/mcp"],
            exp: now + 300,
            iat: now,
            scp: ["ssh-mcp-pro.read", "ssh-mcp-pro.write", 123],
          },
          privateKey,
        )}`,
        config,
      ),
    ).resolves.toEqual(expect.objectContaining({ iss: "https://auth.example" }));

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-scp" },
          {
            iss: "https://auth.example",
            aud: ["https://mcp.example/mcp"],
            exp: now + 300,
            iat: now,
            scp: "ssh-mcp-pro.read ssh-mcp-pro.write",
          },
          privateKey,
        )}`,
        { ...config, jwksUrl: "https://auth.example/.well-known/jwks.json?scp-string" },
      ),
    ).resolves.toEqual(expect.objectContaining({ iss: "https://auth.example" }));
  });

  test("rejects tokens missing required scopes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key-scope";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      { alg: "RS256", kid: "test-key-scope" },
      {
        iss: "https://auth.example",
        aud: "https://mcp.example/mcp",
        exp: now + 300,
        iat: now,
        scope: "other.scope",
      },
      privateKey,
    );

    await expect(
      verifyOAuthAuthorization(`Bearer ${token}`, {
        issuer: "https://auth.example",
        audience: "https://mcp.example/mcp",
        jwksUrl: "https://auth.example/.well-known/jwks.json?scope",
        requiredScopes: ["ssh-mcp-pro.read"],
      }),
    ).rejects.toThrow("required scope");
  });

  test("locks renamed OAuth scope compatibility behavior", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key-scope-migration";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = Math.floor(Date.now() / 1000);
    const config = {
      issuer: "https://auth.example",
      audience: "https://mcp.example/mcp",
      jwksUrl: "https://auth.example/.well-known/jwks.json?scope-migration",
      requiredScopes: ["ssh-mcp-pro.read"],
    };

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-scope-migration" },
          {
            iss: "https://auth.example",
            aud: "https://mcp.example/mcp",
            exp: now + 300,
            iat: now,
            scope: "ssh-mcp-pro.read ssh-mcp-pro.plan",
          },
          privateKey,
        )}`,
        {
          ...config,
          requiredScopes: ["ssh-mcp-pro.read", "ssh-mcp-pro.plan"],
        },
      ),
    ).resolves.toEqual(expect.objectContaining({ iss: "https://auth.example" }));

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-scope-migration" },
          {
            iss: "https://auth.example",
            aud: "https://mcp.example/mcp",
            exp: now + 300,
            iat: now,
            scope: "ssh-mcp-pro.read",
          },
          privateKey,
        )}`,
        {
          ...config,
          jwksUrl: "https://auth.example/.well-known/jwks.json?scope-migration-missing",
          requiredScopes: ["ssh-mcp-pro.read", "ssh-mcp-pro.plan"],
        },
      ),
    ).rejects.toThrow("required scope");

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-scope-migration" },
          {
            iss: "https://auth.example",
            aud: "https://mcp.example/mcp",
            exp: now + 300,
            iat: now,
            scope: "mcp-ssh-tool.read",
          },
          privateKey,
        )}`,
        {
          ...config,
          jwksUrl: "https://auth.example/.well-known/jwks.json?scope-migration-legacy",
        },
      ),
    ).rejects.toThrow("required scope");
  });

  test("rejects invalid audience, expired token, and bad signatures", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const otherKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key-negative";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = Math.floor(Date.now() / 1000);
    const config = {
      issuer: "https://auth.example",
      audience: "https://mcp.example/mcp",
      jwksUrl: "https://auth.example/.well-known/jwks.json?negative",
      requiredScopes: ["ssh-mcp-pro.read"],
    };

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-negative" },
          {
            iss: "https://auth.example",
            aud: "https://wrong.example/mcp",
            exp: now + 300,
            iat: now,
            scope: "ssh-mcp-pro.read",
          },
          privateKey,
        )}`,
        config,
      ),
    ).rejects.toThrow(/aud|audience/i);

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-negative" },
          {
            iss: "https://auth.example",
            aud: "https://mcp.example/mcp",
            exp: now - 60,
            iat: now - 120,
            scope: "ssh-mcp-pro.read",
          },
          privateKey,
        )}`,
        config,
      ),
    ).rejects.toThrow(/exp|expired/i);

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-negative" },
          {
            iss: "https://auth.example",
            aud: "https://mcp.example/mcp",
            exp: now + 300,
            iat: now,
            scope: "ssh-mcp-pro.read",
          },
          otherKeyPair.privateKey,
        )}`,
        config,
      ),
    ).rejects.toThrow("signature");
  });

  test("rejects wrong issuer, wrong algorithm, unknown kid, malformed JWKS, and JWKS timeout", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key-hardening";
    const now = Math.floor(Date.now() / 1000);
    const basePayload = {
      iss: "https://auth.example",
      aud: "https://mcp.example/mcp",
      exp: now + 300,
      iat: now,
      scope: "ssh-mcp-pro.read",
    };
    const config = {
      issuer: "https://auth.example",
      audience: "https://mcp.example/mcp",
      jwksUrl: "https://auth.example/.well-known/jwks.json?hardening",
      requiredScopes: ["ssh-mcp-pro.read"],
    };

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256", kid: "test-key-hardening" },
          { ...basePayload, iss: "https://issuer.example" },
          privateKey,
        )}`,
        config,
      ),
    ).rejects.toThrow(/iss|issuer/i);

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt({ alg: "HS256", kid: "test-key-hardening" }, basePayload, privateKey)}`,
        config,
      ),
    ).rejects.toThrow(/alg|algorithm/i);

    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt({ alg: "RS256", kid: "unknown-key" }, basePayload, privateKey)}`,
        config,
      ),
    ).rejects.toThrow(/key|kid|signature/i);

    globalThis.fetch = async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt({ alg: "RS256", kid: "test-key-hardening" }, basePayload, privateKey)}`,
        {
          ...config,
          jwksUrl: "https://auth.example/.well-known/jwks.json?malformed",
        },
      ),
    ).rejects.toThrow();

    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted")));
      });
    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt({ alg: "RS256", kid: "test-key-hardening" }, basePayload, privateKey)}`,
        {
          ...config,
          jwksUrl: "https://auth.example/.well-known/jwks.json?timeout",
          jwksTimeoutMs: 1,
        },
      ),
    ).rejects.toThrow();
  });

  test("rejects tokens without kid and normalizes non-Error OAuth failures", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key-no-kid";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const now = Math.floor(Date.now() / 1000);
    await expect(
      verifyOAuthAuthorization(
        `Bearer ${signJwt(
          { alg: "RS256" },
          {
            iss: "https://auth.example",
            aud: "https://mcp.example/mcp",
            exp: now + 300,
            iat: now,
          },
          privateKey,
        )}`,
        {
          issuer: "https://auth.example",
          audience: "https://mcp.example/mcp",
          jwksUrl: "https://auth.example/.well-known/jwks.json?no-kid",
          requiredScopes: [],
        },
      ),
    ).rejects.toThrow(/kid|key/i);

    expect(normalizeOAuthError("bad")).toEqual(new Error("bad"));
    expect(normalizeOAuthError(new Error("kept")).message).toBe("kept");
  });
});

function signJwt(header: object, payload: object, privateKey: KeyLike): string {
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
}

function base64Url(value: string | Buffer): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
