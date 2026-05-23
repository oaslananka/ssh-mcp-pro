import path from "node:path";
import {
  REMOTE_CAPABILITIES,
  type AgentPolicy,
  type AgentProfileName,
  type CapabilityPolicy,
} from "./types.js";

type AgentPolicyPatch = Partial<Omit<AgentPolicy, "capabilities">> & {
  capabilities?: Partial<CapabilityPolicy>;
};

function allCapabilities(value: boolean) {
  return Object.fromEntries(REMOTE_CAPABILITIES.map((capability) => [capability, value])) as Record<
    (typeof REMOTE_CAPABILITIES)[number],
    boolean
  >;
}

export function createAgentPolicy(profile: AgentProfileName = "read-only"): AgentPolicy {
  const base = allCapabilities(false);
  let allowServices: string[] = [];
  let allowContainers: string[] = [];

  if (profile === "read-only") {
    base["hosts.read"] = true;
    base["agents.read"] = true;
    base["system.read"] = true;
    base["logs.read"] = true;
    base["audit.read"] = true;
  }

  if (profile === "operations") {
    base["hosts.read"] = true;
    base["agents.read"] = true;
    base["system.read"] = true;
    base["logs.read"] = true;
    base["service.manage"] = true;
    base["docker.manage"] = true;
    base["files.read"] = true;
    base["audit.read"] = true;
  }

  if (profile === "full-admin") {
    for (const capability of REMOTE_CAPABILITIES) {
      base[capability] = true;
    }
    allowServices = ["*"];
    allowContainers = ["*"];
  }

  return {
    profile,
    capabilities: base,
    allowPaths: ["/tmp", "/var/tmp"],
    denyPaths: ["/", "/etc", "/boot", "/dev", "/proc", "/sys"],
    allowServices,
    allowContainers,
    maxOutputBytes: 200_000,
    maxActionTimeoutSeconds: 120,
    version: 1,
  };
}

export function mergeCustomPolicy(policy: AgentPolicyPatch): AgentPolicy {
  const base = createAgentPolicy(policy.profile ?? "custom");
  return {
    ...base,
    ...policy,
    profile: policy.profile ?? "custom",
    capabilities: {
      ...base.capabilities,
      ...(policy.capabilities ?? {}),
    },
    allowPaths: policy.allowPaths ?? base.allowPaths,
    denyPaths: policy.denyPaths ?? base.denyPaths,
    allowServices: policy.allowServices ?? base.allowServices,
    allowContainers: policy.allowContainers ?? base.allowContainers,
    maxOutputBytes: policy.maxOutputBytes ?? base.maxOutputBytes,
    maxActionTimeoutSeconds: policy.maxActionTimeoutSeconds ?? base.maxActionTimeoutSeconds,
    version: policy.version ?? base.version,
  };
}

function normalizePolicyPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/gu, "/"));
  return normalized.replace(/\/$/u, "") || "/";
}

export function isPathAllowed(policy: AgentPolicy, filePath: string): boolean {
  const normalized = normalizePolicyPath(filePath);
  const denied = policy.denyPaths.some((rawPrefix) => {
    const prefix = normalizePolicyPath(rawPrefix);
    if (prefix === "/") {
      return normalized === "/";
    }
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
  if (denied) {
    return false;
  }
  return policy.allowPaths.some((rawPrefix) => {
    const prefix = normalizePolicyPath(rawPrefix);
    return prefix === "/"
      ? normalized === "/"
      : normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

export function isServiceAllowed(policy: AgentPolicy, service: string): boolean {
  return policy.allowServices.includes("*") || policy.allowServices.includes(service);
}

export function isContainerAllowed(policy: AgentPolicy, container: string): boolean {
  return policy.allowContainers.includes("*") || policy.allowContainers.includes(container);
}
