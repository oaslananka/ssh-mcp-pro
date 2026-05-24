import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  CONNECTOR_CREDENTIAL_PROVIDERS,
  ConfigManager,
  type ServerConfig,
} from "../../src/config.js";
import { TOOL_PROFILES } from "../../src/connector-profile.js";
import type { HostKeyPolicy, PolicyMode } from "../../src/types.js";

const ASSERT_OPTIONS = { numRuns: 75 };

const boundedInteger = fc.integer({ min: 1, max: 1_000_000 });
const boundedString = fc.string({ maxLength: 48 }).filter((value) => !value.includes("\0"));
const stringList = fc.array(boundedString, { maxLength: 5 });

const rateLimitConfig = fc.record({
  enabled: fc.boolean(),
  maxRequests: boundedInteger,
  windowMs: boundedInteger,
  perSession: fc.record({
    enabled: fc.boolean(),
    maxRequests: boundedInteger,
    windowMs: boundedInteger,
  }),
});

const securityConfig = fc.record({
  allowRootLogin: fc.boolean(),
  hostKeyPolicy: fc.constantFrom<HostKeyPolicy>("strict", "accept-new", "insecure"),
  knownHostsPath: boundedString,
  allowedCiphers: stringList,
});

const policyConfig = fc.record({
  mode: fc.constantFrom<PolicyMode>("enforce", "explain"),
  allowRootLogin: fc.boolean(),
  allowRawSudo: fc.boolean(),
  allowDestructiveCommands: fc.boolean(),
  allowDestructiveFs: fc.boolean(),
  allowedHosts: stringList,
  commandAllow: stringList,
  commandDeny: stringList,
  pathAllowPrefixes: stringList,
  pathDenyPrefixes: stringList,
  localPathAllowPrefixes: stringList,
  localPathDenyPrefixes: stringList,
  tunnelAllowBindHosts: stringList,
  tunnelDenyBindHosts: stringList,
  tunnelAllowRemoteHosts: stringList,
  tunnelDenyRemoteHosts: stringList,
  tunnelAllowPorts: stringList,
  tunnelDenyPorts: stringList,
});

const httpConfig = fc.record({
  host: boundedString,
  port: fc.integer({ min: 0, max: 65_535 }),
  allowedOrigins: stringList,
  bearerTokenFile: fc.option(boundedString, { nil: undefined }),
  enableLegacySse: fc.boolean(),
  maxRequestBodyBytes: boundedInteger,
  maxSessions: boundedInteger,
  sessionIdleTtlMs: boundedInteger,
  publicUrl: fc.option(boundedString, { nil: undefined }),
  trustProxy: fc.boolean(),
});

const connectorConfig = fc.record({
  toolProfile: fc.constantFrom(...TOOL_PROFILES),
  credentialProvider: fc.constantFrom(...CONNECTOR_CREDENTIAL_PROVIDERS),
  credentialCommand: fc.option(boundedString, { nil: undefined }),
  credentialCommandArgs: stringList,
  credentialCommandTimeoutMs: boundedInteger,
  defaultUsername: fc.option(boundedString, { nil: undefined }),
});

const authConfig = fc.record({
  mode: fc.constantFrom("bearer", "oauth"),
  oauthIssuer: fc.option(boundedString, { nil: undefined }),
  oauthAudience: fc.option(boundedString, { nil: undefined }),
  oauthJwksUrl: fc.option(boundedString, { nil: undefined }),
  oauthResource: fc.option(boundedString, { nil: undefined }),
  oauthRequiredScopes: stringList,
});

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

const serverConfigOverride: fc.Arbitrary<Partial<ServerConfig>> = fc
  .record({
    maxSessions: fc.option(boundedInteger, { nil: undefined }),
    sessionTtlMs: fc.option(boundedInteger, { nil: undefined }),
    cleanupIntervalMs: fc.option(boundedInteger, { nil: undefined }),
    commandTimeoutMs: fc.option(boundedInteger, { nil: undefined }),
    maxCommandOutputBytes: fc.option(boundedInteger, { nil: undefined }),
    maxStreamChunks: fc.option(boundedInteger, { nil: undefined }),
    maxFileSize: fc.option(boundedInteger, { nil: undefined }),
    maxFileWriteBytes: fc.option(boundedInteger, { nil: undefined }),
    maxTransferBytes: fc.option(boundedInteger, { nil: undefined }),
    debug: fc.option(fc.boolean(), { nil: undefined }),
    rateLimit: fc.option(rateLimitConfig, { nil: undefined }),
    security: fc.option(securityConfig, { nil: undefined }),
    policy: fc.option(policyConfig, { nil: undefined }),
    http: fc.option(httpConfig, { nil: undefined }),
    connector: fc.option(connectorConfig, { nil: undefined }),
    auth: fc.option(authConfig, { nil: undefined }),
  })
  .map((overrides) => compact(overrides));

describe("ConfigManager property invariants", () => {
  test("construction never throws for valid generated partial overrides", () => {
    fc.assert(
      fc.property(serverConfigOverride, (overrides) => {
        expect(() => new ConfigManager(overrides)).not.toThrow();
      }),
      ASSERT_OPTIONS,
    );
  });

  test("programmatic root-login policy override wins over security propagation", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (securityAllowRoot, policyAllowRoot) => {
        const config = new ConfigManager({
          security: {
            allowRootLogin: securityAllowRoot,
            hostKeyPolicy: "strict",
            knownHostsPath: "/tmp/known_hosts",
            allowedCiphers: [],
          },
          policy: {
            mode: "enforce",
            allowRootLogin: policyAllowRoot,
            allowRawSudo: false,
            allowDestructiveCommands: false,
            allowDestructiveFs: false,
            allowedHosts: [],
            commandAllow: [],
            commandDeny: [],
            pathAllowPrefixes: ["/tmp"],
            pathDenyPrefixes: [],
            localPathAllowPrefixes: ["/tmp"],
            localPathDenyPrefixes: [],
            tunnelAllowBindHosts: [],
            tunnelDenyBindHosts: [],
            tunnelAllowRemoteHosts: [],
            tunnelDenyRemoteHosts: [],
            tunnelAllowPorts: [],
            tunnelDenyPorts: [],
          },
        });

        expect(config.get("policy").allowRootLogin).toBe(policyAllowRoot);
      }),
      ASSERT_OPTIONS,
    );
  });

  test("rate limit overrides preserve per-session configuration exactly", () => {
    fc.assert(
      fc.property(rateLimitConfig, (rateLimit) => {
        const config = new ConfigManager({ rateLimit });

        expect(config.get("rateLimit")).toEqual(rateLimit);
      }),
      ASSERT_OPTIONS,
    );
  });
});
