import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  filterToolsForProfile,
  isToolAllowedForProfile,
  type ToolProfile,
} from "../connector-profile.js";
import { logger } from "../logging.js";
import type { ToolCallResult, ToolErrorResponse, ToolProvider } from "./types.js";

const TOOL_ALIASES: Record<string, string> = {
  "ssh.openSession": "ssh_open_session",
  "ssh.closeSession": "ssh_close_session",
  "proc.exec": "proc_exec",
  "proc.sudo": "proc_sudo",
  "fs.read": "fs_read",
  "fs.write": "fs_write",
  "fs.stat": "fs_stat",
  "fs.list": "fs_list",
  "fs.mkdirp": "fs_mkdirp",
  "fs.rmrf": "fs_rmrf",
  "fs.rename": "fs_rename",
  "ensure.package": "ensure_package",
  "ensure.service": "ensure_service",
  "ensure.linesInFile": "ensure_lines_in_file",
  "patch.apply": "patch_apply",
  "os.detect": "os_detect",
  "ssh.listSessions": "ssh_list_sessions",
  "ssh.ping": "ssh_ping",
  "ssh.listConfiguredHosts": "ssh_list_configured_hosts",
  "ssh.resolveHost": "ssh_resolve_host",
  "connector.status": "connector_status",
  "ssh.hostsList": "ssh_hosts_list",
  "ssh.policyExplain": "ssh_policy_explain",
  "ssh.hostInspect": "ssh_host_inspect",
  "ssh.mutationPlan": "ssh_mutation_plan",
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toToolErrorResponse(
  payload: Record<string, unknown>,
  fallbackCode = "ETOOL",
): ToolErrorResponse {
  const response: ToolErrorResponse = {
    error: true,
    code: optionalString(payload.code) ?? fallbackCode,
    message: optionalString(payload.message) ?? "Tool call failed.",
  };
  const hint = optionalString(payload.hint);
  if (hint !== undefined) {
    response.hint = hint;
  }
  if (typeof payload.recoverable === "boolean") {
    response.recoverable = payload.recoverable;
  }
  const suggestedAction = optionalString(payload.suggestedAction);
  if (suggestedAction !== undefined) {
    response.suggestedAction = suggestedAction;
  }
  return response;
}

function errorResult(payload: Record<string, unknown>, fallbackCode?: string): ToolCallResult {
  const structuredContent = toToolErrorResponse(payload, fallbackCode);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isToolCallResult(value: unknown): value is ToolCallResult {
  return isRecord(value) && "content" in value && Array.isArray(value.content);
}

function normalizeToolCallResult(result: ToolCallResult): ToolCallResult {
  if (!isRecord(result.structuredContent)) {
    return errorResult({
      code: "ESTRUCTUREDCONTENT",
      message: "Tool handlers returning CallToolResult must include structuredContent.",
    });
  }

  if (result.content.length === 0) {
    return errorResult({
      code: "ETOOLCONTENT",
      message: "Tool handlers returning CallToolResult must include at least one content item.",
    });
  }

  return result;
}

function normalizeDataResult(data: unknown): ToolCallResult {
  if (!isRecord(data)) {
    return errorResult({
      code: "ESTRUCTUREDCONTENT",
      message: "Tool handlers must return a structured JSON object or CallToolResult.",
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export class ToolRegistry {
  private readonly providers = new Map<string, ToolProvider>();

  constructor(private readonly toolProfile: ToolProfile = "full") {}

  register(provider: ToolProvider): this {
    if (this.providers.has(provider.namespace)) {
      throw new Error(`ToolRegistry: namespace "${provider.namespace}" is already registered`);
    }

    this.providers.set(provider.namespace, provider);
    logger.debug("ToolRegistry: registered provider", {
      namespace: provider.namespace,
    });
    return this;
  }

  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const provider of this.providers.values()) {
      tools.push(
        ...provider.getTools().map((tool) => ({
          ...tool,
          title: tool.title ?? tool.annotations?.title,
        })),
      );
    }
    return filterToolsForProfile(tools, this.toolProfile);
  }

  async dispatch(rawToolName: string, args: unknown): Promise<ToolCallResult> {
    const toolName = TOOL_ALIASES[rawToolName] ?? rawToolName;
    if (!isToolAllowedForProfile(toolName, this.toolProfile)) {
      return errorResult({
        code: "ETOOLPROFILE",
        message: `Tool ${toolName} is not exposed by the ${this.toolProfile} connector profile`,
      });
    }

    for (const provider of this.providers.values()) {
      const result = provider.handleTool(toolName, args);
      if (result === undefined) {
        continue;
      }

      try {
        const data = await result;
        if (isToolCallResult(data)) {
          return normalizeToolCallResult(data);
        }
        return normalizeDataResult(data);
      } catch (error) {
        logger.error("Tool handler error", {
          toolName,
          error: error instanceof Error ? error.message : String(error),
        });

        if (
          error &&
          typeof error === "object" &&
          "toJSON" in error &&
          typeof error.toJSON === "function"
        ) {
          const structuredError = error.toJSON() as Record<string, unknown>;
          return errorResult(structuredError);
        }

        const message = error instanceof Error ? error.message : String(error);
        return errorResult({ message });
      }
    }

    return errorResult(
      { code: "ETOOLNOTFOUND", message: `Unknown tool: ${toolName}` },
      "ETOOLNOTFOUND",
    );
  }
}
