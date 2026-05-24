import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  PolicyEngine,
  type PolicyAction,
  type PolicyConfig,
  type PolicyContext,
} from "../../src/policy.js";
import type { PolicyMode } from "../../src/types.js";

const ASSERT_OPTIONS = { numRuns: 75 };

const POLICY_ACTIONS = [
  "ssh.open",
  "proc.exec",
  "proc.sudo",
  "fs.read",
  "fs.stat",
  "fs.list",
  "fs.write",
  "fs.remove",
  "fs.mkdir",
  "fs.rename",
  "ensure.package",
  "ensure.service",
  "ensure.lines",
  "patch.apply",
  "transfer.upload",
  "transfer.download",
  "transfer.local.read",
  "transfer.local.write",
  "transfer.local.create",
  "transfer.local.overwrite",
  "tunnel.local",
  "tunnel.remote",
] as const satisfies readonly PolicyAction[];

function basePolicy(overrides: Partial<PolicyConfig> = {}): PolicyEngine {
  return new PolicyEngine({
    mode: "enforce",
    allowRootLogin: false,
    allowRawSudo: false,
    allowDestructiveCommands: false,
    allowDestructiveFs: false,
    allowedHosts: [],
    commandAllow: [],
    commandDeny: [],
    pathAllowPrefixes: ["/tmp", "/var/tmp"],
    pathDenyPrefixes: ["/etc/shadow"],
    localPathAllowPrefixes: ["/tmp"],
    localPathDenyPrefixes: [],
    tunnelAllowBindHosts: ["127.0.0.1", "localhost"],
    tunnelDenyBindHosts: ["0.0.0.0"],
    tunnelAllowRemoteHosts: [],
    tunnelDenyRemoteHosts: [],
    tunnelAllowPorts: [],
    tunnelDenyPorts: [],
    ...overrides,
  });
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const safeString = fc.string({ maxLength: 48 }).filter((value) => !value.includes("\0"));
const nonEmptyToken = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,23}$/u);
const optionalSafeString = fc.option(safeString, { nil: undefined });
const optionalPort = fc.option(fc.integer({ min: 0, max: 65_535 }), { nil: undefined });
const optionalMode = fc.option(fc.constantFrom<PolicyMode>("enforce", "explain"), {
  nil: undefined,
});

const policyContextArbitrary: fc.Arbitrary<PolicyContext> = fc
  .record({
    action: fc.constantFrom(...POLICY_ACTIONS),
    host: optionalSafeString,
    username: optionalSafeString,
    command: optionalSafeString,
    path: optionalSafeString,
    secondaryPath: optionalSafeString,
    localBindHost: optionalSafeString,
    localPort: optionalPort,
    remoteHost: optionalSafeString,
    remotePort: optionalPort,
    mode: optionalMode,
    rawSudo: fc.option(fc.boolean(), { nil: undefined }),
    destructive: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map((context) => compact(context) as PolicyContext);

describe("PolicyEngine property invariants", () => {
  test("check never throws for generated valid policy contexts", () => {
    const engine = basePolicy();

    fc.assert(
      fc.property(policyContextArbitrary, (context) => {
        expect(() => engine.check(context)).not.toThrow();
      }),
      ASSERT_OPTIONS,
    );
  });

  test("non-overlapping command allow and deny policies are order-independent", () => {
    fc.assert(
      fc.property(fc.uniqueArray(nonEmptyToken, { minLength: 4, maxLength: 8 }), (tokens) => {
        const [target, ...otherTokens] = tokens;
        const command = `cmd-${target}`;
        const allowPatterns = [
          `^cmd-${escapeRegex(target)}$`,
          ...otherTokens.slice(0, 2).map((token) => `^cmd-${escapeRegex(token)}$`),
        ];
        const denyPatterns = otherTokens.slice(2).map((token) => `^blocked-${escapeRegex(token)}$`);

        const forwardDecision = basePolicy({
          commandAllow: allowPatterns,
          commandDeny: denyPatterns,
        }).check({ action: "proc.exec", command, mode: "explain" });
        const reversedDecision = basePolicy({
          commandAllow: [...allowPatterns].reverse(),
          commandDeny: [...denyPatterns].reverse(),
        }).check({ action: "proc.exec", command, mode: "explain" });

        expect(reversedDecision.allowed).toBe(forwardDecision.allowed);
        expect(reversedDecision.reason).toBe(forwardDecision.reason);
      }),
      ASSERT_OPTIONS,
    );
  });

  test("hosts explicitly present in allowedHosts are not denied by host policy", () => {
    fc.assert(
      fc.property(nonEmptyToken, (host) => {
        const decision = basePolicy({
          allowedHosts: [`^${escapeRegex(host)}$`],
        }).check({ action: "ssh.open", host, username: "deploy", mode: "explain" });

        expect(decision.allowed).toBe(true);
        expect(decision.reason ?? "").not.toContain("not allowed by policy");
      }),
      ASSERT_OPTIONS,
    );
  });
});
