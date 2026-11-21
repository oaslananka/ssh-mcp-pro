import { readFileSync } from "node:fs";

let cachedVersion: string | undefined;

/** Read the installed package, not the caller's npm lifecycle environment. */
export function installedPackageVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const metadata = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (
      typeof metadata.version === "string" &&
      metadata.version.length > 0 &&
      metadata.version.length <= 128
    ) {
      cachedVersion = metadata.version;
    }
  } catch {
    // Unknown is preferable to asserting a version that could not be read.
  }
  return cachedVersion ?? "unknown";
}

export type AgentUpdateStatus =
  "unknown" | "older_than_server" | "same_as_server" | "newer_than_server";

function stableVersionParts(version: string | undefined): number[] | undefined {
  if (!version || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u.test(version))
    return undefined;
  return version.split(".").map(Number);
}

/** This is a comparison with the deployed server, not the newest registry release. */
export function compareAgentVersion(
  agentVersion: string | undefined,
  serverVersion: string,
): AgentUpdateStatus {
  const agent = stableVersionParts(agentVersion);
  const server = stableVersionParts(serverVersion);
  if (!agent || !server) return "unknown";
  for (const [index, component] of agent.entries()) {
    const difference = component - (server[index] ?? 0);
    if (difference < 0) return "older_than_server";
    if (difference > 0) return "newer_than_server";
  }
  return "same_as_server";
}
