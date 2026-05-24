import * as fs from "node:fs";
import * as path from "node:path";
import { posix as posixPath } from "node:path";
import { createPolicyError } from "./errors.js";
import { checkCommandSafety } from "./safety.js";
import type { PolicyMode } from "./types.js";

export interface PolicyConfig {
  mode: PolicyMode;
  allowRootLogin: boolean;
  allowRawSudo: boolean;
  allowDestructiveCommands: boolean;
  allowDestructiveFs: boolean;
  allowedHosts: string[];
  commandAllow: string[];
  commandDeny: string[];
  pathAllowPrefixes: string[];
  pathDenyPrefixes: string[];
  localPathAllowPrefixes: string[];
  localPathDenyPrefixes: string[];
  tunnelAllowBindHosts: string[];
  tunnelDenyBindHosts: string[];
  tunnelAllowRemoteHosts: string[];
  tunnelDenyRemoteHosts: string[];
  tunnelAllowPorts: string[];
  tunnelDenyPorts: string[];
}

export type PolicyAction =
  | "ssh.open"
  | "proc.exec"
  | "proc.sudo"
  | "fs.read"
  | "fs.stat"
  | "fs.list"
  | "fs.write"
  | "fs.remove"
  | "fs.mkdir"
  | "fs.rename"
  | "ensure.package"
  | "ensure.service"
  | "ensure.lines"
  | "patch.apply"
  | "transfer.upload"
  | "transfer.download"
  | "transfer.local.read"
  | "transfer.local.write"
  | "transfer.local.create"
  | "transfer.local.overwrite"
  | "tunnel.local"
  | "tunnel.remote";

export interface PolicyContext {
  action: PolicyAction;
  host?: string;
  username?: string;
  command?: string;
  path?: string;
  secondaryPath?: string;
  localBindHost?: string;
  localPort?: number;
  remoteHost?: string;
  remotePort?: number;
  mode?: PolicyMode;
  rawSudo?: boolean;
  destructive?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  mode: PolicyMode;
  action: PolicyAction;
  reason?: string;
  hint?: string;
  riskLevel?: string;
}

export type PolicyDecisionObserver = (decision: PolicyDecision, context: PolicyContext) => void;

const DEFAULT_ALLOWED_MUTATION_PREFIXES = ["/tmp", "/var/tmp", "/home", "/Users"];
const LOCAL_TRANSFER_ACTIONS = new Set<PolicyAction>([
  "transfer.local.read",
  "transfer.local.write",
  "transfer.local.create",
  "transfer.local.overwrite",
]);

function compile(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => compile(pattern)?.test(value));
}

function matchesPolicyValue(value: string, policies: string[]): boolean {
  return policies.some((policy) => policy === value || matchesAny(value, [policy]));
}

function parsePortRange(policy: string): { start: number; end: number } | undefined {
  const trimmed = policy.trim();
  const range = /^(\d{1,5})(?:-(\d{1,5}))?$/u.exec(trimmed);
  if (!range) {
    return undefined;
  }

  const start = Number(range[1]);
  const end = range[2] === undefined ? start : Number(range[2]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > 65535 ||
    start > end
  ) {
    return undefined;
  }

  return { start, end };
}

function matchesPortPolicy(port: number, policies: string[]): boolean {
  return policies.some((policy) => {
    const range = parsePortRange(policy);
    return range ? port >= range.start && port <= range.end : false;
  });
}

export function isSegmentBoundaryPathMatch(
  candidate: string,
  prefix: string,
  separator: string,
): boolean {
  return candidate === prefix || candidate.startsWith(`${prefix}${separator}`);
}

function stripTrailingSeparators(value: string, separator: string, root: string): string {
  let stripped = value;
  while (stripped.length > root.length && stripped.endsWith(separator)) {
    stripped = stripped.slice(0, -separator.length);
  }
  return stripped;
}

function resolveLocalExistingPrefix(normalizedPath: string): string {
  const pendingSegments: string[] = [];
  let candidate = normalizedPath;

  while (true) {
    try {
      const resolvedPrefix = fs.realpathSync.native(candidate);
      return path.join(resolvedPrefix, ...pendingSegments.reverse());
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        return normalizedPath;
      }

      pendingSegments.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

export function normalizeRemotePosixPath(pathValue: string): string {
  if (pathValue.includes("\0")) {
    throw new Error("Path contains NUL byte");
  }

  const unixSeparators = pathValue.replace(/\\/g, "/");
  const absolutePath = unixSeparators.startsWith("/") ? unixSeparators : `/${unixSeparators}`;
  const normalized = posixPath.normalize(absolutePath);
  return stripTrailingSeparators(normalized, "/", "/");
}

function normalizeLocalPolicyPath(pathValue: string): string {
  if (pathValue.includes("\0")) {
    throw new Error("Path contains NUL byte");
  }

  const absolutePath = path.resolve(pathValue);
  const normalized = resolveLocalExistingPrefix(path.normalize(absolutePath));

  return stripTrailingSeparators(normalized, path.sep, path.parse(normalized).root);
}

function normalizePolicyPaths(
  paths: string[] | undefined,
  normalizer: (pathValue: string) => string,
): string[] {
  return [...new Set((paths ?? []).map((pathValue) => normalizer(pathValue)))];
}

function isPathUnder(pathValue: string, prefix: string, separator: string): boolean {
  if (prefix === "/" || prefix === path.parse(prefix).root) {
    return true;
  }
  return isSegmentBoundaryPathMatch(pathValue, prefix, separator);
}

function denied(decision: Omit<PolicyDecision, "allowed">): PolicyDecision {
  return { ...decision, allowed: false };
}

function allowed(decision: Omit<PolicyDecision, "allowed">): PolicyDecision {
  return { ...decision, allowed: true };
}

export class PolicyEngine {
  private readonly pathAllowPrefixes: string[];
  private readonly pathDenyPrefixes: string[];
  private readonly defaultPathAllowPrefixes: string[];
  private readonly localPathAllowPrefixes: string[];
  private readonly localPathDenyPrefixes: string[];

  constructor(
    private readonly config: PolicyConfig,
    private readonly observer?: PolicyDecisionObserver,
  ) {
    this.pathAllowPrefixes = normalizePolicyPaths(
      config.pathAllowPrefixes,
      normalizeRemotePosixPath,
    );
    this.pathDenyPrefixes = normalizePolicyPaths(config.pathDenyPrefixes, normalizeRemotePosixPath);
    this.defaultPathAllowPrefixes = normalizePolicyPaths(
      DEFAULT_ALLOWED_MUTATION_PREFIXES,
      normalizeRemotePosixPath,
    );
    this.localPathAllowPrefixes = normalizePolicyPaths(
      config.localPathAllowPrefixes,
      normalizeLocalPolicyPath,
    );
    this.localPathDenyPrefixes = normalizePolicyPaths(
      config.localPathDenyPrefixes,
      normalizeLocalPolicyPath,
    );
  }

  getEffectivePolicy(): PolicyConfig {
    return {
      ...this.config,
      allowedHosts: [...this.config.allowedHosts],
      commandAllow: [...this.config.commandAllow],
      commandDeny: [...this.config.commandDeny],
      pathAllowPrefixes: [...this.config.pathAllowPrefixes],
      pathDenyPrefixes: [...this.config.pathDenyPrefixes],
      localPathAllowPrefixes: [...(this.config.localPathAllowPrefixes ?? [])],
      localPathDenyPrefixes: [...(this.config.localPathDenyPrefixes ?? [])],
      tunnelAllowBindHosts: [...(this.config.tunnelAllowBindHosts ?? [])],
      tunnelDenyBindHosts: [...(this.config.tunnelDenyBindHosts ?? [])],
      tunnelAllowRemoteHosts: [...(this.config.tunnelAllowRemoteHosts ?? [])],
      tunnelDenyRemoteHosts: [...(this.config.tunnelDenyRemoteHosts ?? [])],
      tunnelAllowPorts: [...(this.config.tunnelAllowPorts ?? [])],
      tunnelDenyPorts: [...(this.config.tunnelDenyPorts ?? [])],
    };
  }

  evaluate(context: PolicyContext): PolicyDecision {
    const mode = context.mode ?? this.config.mode;

    if (context.host && this.config.allowedHosts.length > 0) {
      const hostAllowed = this.config.allowedHosts.some(
        (host) => host === context.host || matchesAny(context.host ?? "", [host]),
      );
      if (!hostAllowed) {
        return denied({
          mode,
          action: context.action,
          reason: `Host ${context.host} is not allowed by policy`,
          hint: "Add the host to allowedHosts or use an SSH config alias that is allowed.",
        });
      }
    }

    if (context.action === "tunnel.local" || context.action === "tunnel.remote") {
      const bindHost = context.localBindHost;
      if (
        bindHost &&
        (this.config.tunnelDenyBindHosts ?? []).length > 0 &&
        matchesPolicyValue(bindHost, this.config.tunnelDenyBindHosts)
      ) {
        return denied({
          mode,
          action: context.action,
          reason: `Tunnel bind host ${bindHost} is denied by policy`,
          hint: "Choose an allowed bind host or adjust tunnelDenyBindHosts.",
        });
      }
      if (
        bindHost &&
        (this.config.tunnelAllowBindHosts ?? []).length > 0 &&
        !matchesPolicyValue(bindHost, this.config.tunnelAllowBindHosts)
      ) {
        return denied({
          mode,
          action: context.action,
          reason: `Tunnel bind host ${bindHost} is outside allowed policy`,
          hint: "Choose an allowed bind host or adjust tunnelAllowBindHosts.",
        });
      }

      const remoteHost = context.remoteHost;
      if (
        remoteHost &&
        (this.config.tunnelDenyRemoteHosts ?? []).length > 0 &&
        matchesPolicyValue(remoteHost, this.config.tunnelDenyRemoteHosts)
      ) {
        return denied({
          mode,
          action: context.action,
          reason: `Tunnel remote host ${remoteHost} is denied by policy`,
          hint: "Choose an allowed remote host or adjust tunnelDenyRemoteHosts.",
        });
      }
      if (
        remoteHost &&
        (this.config.tunnelAllowRemoteHosts ?? []).length > 0 &&
        !matchesPolicyValue(remoteHost, this.config.tunnelAllowRemoteHosts)
      ) {
        return denied({
          mode,
          action: context.action,
          reason: `Tunnel remote host ${remoteHost} is outside allowed policy`,
          hint: "Choose an allowed remote host or adjust tunnelAllowRemoteHosts.",
        });
      }

      const ports = [context.localPort, context.remotePort].filter(
        (port): port is number => typeof port === "number",
      );
      for (const port of ports) {
        if (
          (this.config.tunnelDenyPorts ?? []).length > 0 &&
          matchesPortPolicy(port, this.config.tunnelDenyPorts)
        ) {
          return denied({
            mode,
            action: context.action,
            reason: `Tunnel port ${port} is denied by policy`,
            hint: "Choose a different port or adjust tunnelDenyPorts.",
          });
        }
        if (
          (this.config.tunnelAllowPorts ?? []).length > 0 &&
          !matchesPortPolicy(port, this.config.tunnelAllowPorts)
        ) {
          return denied({
            mode,
            action: context.action,
            reason: `Tunnel port ${port} is outside allowed policy`,
            hint: "Choose an allowed port or adjust tunnelAllowPorts.",
          });
        }
      }
    }

    if (context.username === "root" && !this.config.allowRootLogin) {
      return denied({
        mode,
        action: context.action,
        reason: "Root SSH login is disabled by policy",
        hint: "Connect as an unprivileged user and use approved ensure tools where possible.",
      });
    }

    if (context.rawSudo && !this.config.allowRawSudo) {
      return denied({
        mode,
        action: context.action,
        reason: "Raw sudo command execution is disabled by policy",
        hint: "Use an idempotent ensure_* tool or enable allowRawSudo explicitly.",
      });
    }

    if (context.command) {
      if (
        this.config.commandDeny.length > 0 &&
        matchesAny(context.command, this.config.commandDeny)
      ) {
        return denied({
          mode,
          action: context.action,
          reason: "Command matched commandDeny policy",
          hint: "Review the command or adjust the policy.",
        });
      }

      if (
        this.config.commandAllow.length > 0 &&
        !matchesAny(context.command, this.config.commandAllow)
      ) {
        return denied({
          mode,
          action: context.action,
          reason: "Command does not match commandAllow policy",
          hint: "Use an allowed command or update commandAllow.",
        });
      }

      const safety = checkCommandSafety(context.command);
      if (!safety.safe && !this.config.allowDestructiveCommands) {
        return denied({
          mode,
          action: context.action,
          reason: safety.warning ?? "Command is considered unsafe",
          hint:
            safety.suggestion ?? "Review the command before enabling destructive command policy.",
          ...(safety.riskLevel ? { riskLevel: safety.riskLevel } : {}),
        });
      }
    }

    const paths = [context.path, context.secondaryPath].filter((pathValue): pathValue is string =>
      Boolean(pathValue),
    );
    if (LOCAL_TRANSFER_ACTIONS.has(context.action)) {
      for (const pathValue of paths) {
        let normalizedPath: string;
        try {
          normalizedPath = normalizeLocalPolicyPath(pathValue);
        } catch {
          return denied({
            mode,
            action: context.action,
            reason: "Local path contains NUL byte",
            hint: "Choose a valid local path without NUL bytes.",
          });
        }

        if (
          this.localPathDenyPrefixes.some((prefix) => isPathUnder(normalizedPath, prefix, path.sep))
        ) {
          return denied({
            mode,
            action: context.action,
            reason: `Local path ${pathValue} is denied by policy`,
            hint: "Choose a different local path or adjust localPathDenyPrefixes.",
          });
        }

        if (this.localPathAllowPrefixes.length === 0) {
          return denied({
            mode,
            action: context.action,
            reason: "Local transfer path policy has no allowed prefixes",
            hint: "Set localPathAllowPrefixes for MCP-server-host transfer paths.",
          });
        }

        const underAllowedPrefix = this.localPathAllowPrefixes.some((prefix) =>
          isPathUnder(normalizedPath, prefix, path.sep),
        );
        if (!underAllowedPrefix) {
          return denied({
            mode,
            action: context.action,
            reason: `Local path ${pathValue} is outside allowed prefixes`,
            hint: `Allowed local transfer prefixes: ${this.localPathAllowPrefixes.join(", ")}`,
          });
        }
      }

      return allowed({ mode, action: context.action });
    }

    for (const pathValue of paths) {
      let normalizedPath: string;
      try {
        normalizedPath = normalizeRemotePosixPath(pathValue);
      } catch {
        return denied({
          mode,
          action: context.action,
          reason: "Path contains NUL byte",
          hint: "Choose a valid remote path without NUL bytes.",
        });
      }

      if (this.pathDenyPrefixes.some((prefix) => isPathUnder(normalizedPath, prefix, "/"))) {
        return denied({
          mode,
          action: context.action,
          reason: `Path ${pathValue} is denied by policy`,
          hint: "Choose a different path or adjust pathDenyPrefixes.",
        });
      }

      const isDestructiveFs = (context.destructive ?? false) || context.action === "fs.remove";
      const allowPrefixes =
        this.pathAllowPrefixes.length > 0 ? this.pathAllowPrefixes : this.defaultPathAllowPrefixes;

      if (isDestructiveFs && !this.config.allowDestructiveFs) {
        const underAllowedPrefix = allowPrefixes.some((prefix) =>
          isPathUnder(normalizedPath, prefix, "/"),
        );
        if (!underAllowedPrefix) {
          return denied({
            mode,
            action: context.action,
            reason: `Destructive filesystem operation on ${pathValue} is outside allowed prefixes`,
            hint: `Allowed destructive prefixes: ${allowPrefixes.join(", ")}`,
          });
        }
      }
    }

    return allowed({ mode, action: context.action });
  }

  assertAllowed(context: PolicyContext): PolicyDecision {
    const decision = this.evaluate(context);
    this.observer?.(decision, context);
    if (!decision.allowed && decision.mode === "enforce") {
      throw createPolicyError(decision.reason ?? "Operation denied by policy", decision.hint);
    }
    return decision;
  }

  check(context: PolicyContext): PolicyDecision {
    const decision = this.evaluate(context);
    this.observer?.(decision, context);
    return decision;
  }

  explain(context: PolicyContext): PolicyDecision {
    const decision = this.evaluate({ ...context, mode: "explain" });
    this.observer?.(decision, { ...context, mode: "explain" });
    return decision;
  }
}
