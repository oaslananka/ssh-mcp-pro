import { getConfiguredHosts } from "./ssh-config.js";
import type { AppContainer } from "./container.js";
import {
  filterResourcesForProfile,
  isResourceAllowedForProfile,
  type ToolProfile,
} from "./connector-profile.js";

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const RESOURCE_DEFINITIONS: readonly MCPResource[] = [
  {
    uri: "ssh-mcp-pro://sessions/active",
    name: "Active SSH sessions",
    description: "Current in-memory SSH sessions tracked by the session manager",
    mimeType: "application/json",
  },
  {
    uri: "ssh-mcp-pro://metrics/json",
    name: "Metrics snapshot",
    description: "Current runtime metrics in JSON format",
    mimeType: "application/json",
  },
  {
    uri: "ssh-mcp-pro://metrics/prometheus",
    name: "Prometheus metrics",
    description: "Prometheus-formatted metrics export",
    mimeType: "text/plain",
  },
  {
    uri: "ssh-mcp-pro://ssh-config/hosts",
    name: "Configured SSH hosts",
    description: "Parsed host aliases from the local ~/.ssh/config cache",
    mimeType: "application/json",
  },
  {
    uri: "ssh-mcp-pro://policy/effective",
    name: "Effective safety policy",
    description: "Current command, path, host, and privilege policy after env/file overrides",
    mimeType: "application/json",
  },
  {
    uri: "ssh-mcp-pro://audit/recent",
    name: "Recent audit events",
    description: "Recent policy and high-risk operation audit events",
    mimeType: "application/json",
  },
  {
    uri: "ssh-mcp-pro://capabilities/support-matrix",
    name: "Support matrix",
    description: "Supported and experimental host capabilities for this server",
    mimeType: "application/json",
  },
] as const;

export function listResources(profile: ToolProfile = "full"): { resources: MCPResource[] } {
  return {
    resources: filterResourcesForProfile(
      RESOURCE_DEFINITIONS.map((resource) => ({ ...resource })),
      profile,
    ),
  };
}

export async function readResource(
  uri: string,
  container: AppContainer,
  profile: ToolProfile = "full",
): Promise<{
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}> {
  if (!isResourceAllowedForProfile(uri, profile)) {
    throw new Error(`Resource ${uri} is not exposed by the ${profile} connector profile`);
  }

  switch (uri) {
    case "ssh-mcp-pro://sessions/active":
      return jsonResource(uri, "application/json", container.sessionManager.getActiveSessions());
    case "ssh-mcp-pro://metrics/json":
      return jsonResource(uri, "application/json", container.metrics.getMetrics());
    case "ssh-mcp-pro://metrics/prometheus":
      return textResource(uri, "text/plain", container.metrics.exportPrometheus());
    case "ssh-mcp-pro://ssh-config/hosts":
      return jsonResource(uri, "application/json", {
        hosts: await getConfiguredHosts(),
      });
    case "ssh-mcp-pro://policy/effective":
      return jsonResource(uri, "application/json", container.policy.getEffectivePolicy());
    case "ssh-mcp-pro://audit/recent":
      return jsonResource(uri, "application/json", { events: container.auditLog.list(100) });
    case "ssh-mcp-pro://capabilities/support-matrix":
      return jsonResource(uri, "application/json", {
        linux: "full",
        macos: "session/process/fs/transfer; package/service helpers limited to tested managers",
        "BusyBox/dropbear": "experimental: session/process/basic fs without SFTP",
        windows:
          "experimental: session/process/fs/transfer; ensure_package supports winget/choco; sudo/service helpers unsupported",
      });
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

function jsonResource(
  uri: string,
  mimeType: string,
  value: unknown,
): {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
} {
  return textResource(uri, mimeType, JSON.stringify(value, null, 2));
}

function textResource(
  uri: string,
  mimeType: string,
  text: string,
): {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
} {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}
