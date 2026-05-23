import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { EnsureService } from "../ensure.js";
import { logger } from "../logging.js";
import {
  EnsureLinesSchema,
  EnsurePackageSchema,
  EnsureServiceSchema,
  PatchApplySchema,
} from "../types.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

export interface EnsureToolProviderDeps {
  ensureService: EnsureService;
}

export class EnsureToolProvider implements ToolProvider {
  readonly namespace = "ensure";

  constructor(private readonly deps: EnsureToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "ensure_package",
        description: "Ensures a package is installed or removed",
        annotations: annotate({
          title: "Ensure Package State",
          readOnly: false,
          destructive: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Package state result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            name: { type: "string", description: "Package name" },
            state: {
              type: "string",
              enum: ["present", "absent"],
              description: "Desired state",
            },
          },
          required: ["sessionId", "name"],
        },
      },
      {
        name: "ensure_service",
        description: "Ensures a service is in the desired state",
        annotations: annotate({
          title: "Ensure Service State",
          readOnly: false,
          destructive: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Service state result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            name: { type: "string", description: "Service name" },
            state: {
              type: "string",
              enum: ["started", "stopped", "restarted", "enabled", "disabled"],
              description: "Desired state",
            },
          },
          required: ["sessionId", "name", "state"],
        },
      },
      {
        name: "ensure_lines_in_file",
        description: "Ensures specific lines are present or absent in a file",
        annotations: annotate({
          title: "Ensure Lines In File",
          readOnly: false,
          destructive: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Line management result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "File path" },
            lines: {
              type: "array",
              items: { type: "string" },
              description: "Lines to manage",
            },
            state: {
              type: "string",
              enum: ["present", "absent"],
              description: "Desired state",
            },
            createIfMissing: {
              type: "boolean",
              description: "Create file if it does not exist",
            },
          },
          required: ["sessionId", "path", "lines"],
        },
      },
      {
        name: "patch_apply",
        description: "Applies a patch to a file",
        annotations: annotate({
          title: "Apply Patch",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Patch application result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "File path to patch" },
            diff: {
              type: "string",
              description: "Patch content (unified diff format)",
            },
          },
          required: ["sessionId", "path", "diff"],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "ensure_package":
        return this.ensurePackage(args);
      case "ensure_service":
        return this.ensureSystemService(args);
      case "ensure_lines_in_file":
        return this.ensureLines(args);
      case "patch_apply":
        return this.applyPatch(args);
      default:
        return undefined;
    }
  }

  private async ensurePackage(args: unknown): Promise<unknown> {
    const params = EnsurePackageSchema.parse(args);
    const result = await this.deps.ensureService.ensurePackage(
      params.sessionId,
      params.name,
      params.state,
    );
    logger.info("Package ensured", {
      sessionId: params.sessionId,
      name: params.name,
      state: params.state,
    });
    return result;
  }

  private async ensureSystemService(args: unknown): Promise<unknown> {
    const params = EnsureServiceSchema.parse(args);
    const result = await this.deps.ensureService.ensureService(
      params.sessionId,
      params.name,
      params.state,
    );
    logger.info("Service ensured", {
      sessionId: params.sessionId,
      name: params.name,
      state: params.state,
    });
    return result;
  }

  private async ensureLines(args: unknown): Promise<unknown> {
    const params = EnsureLinesSchema.parse(args);
    const result = await this.deps.ensureService.ensureLinesInFile(
      params.sessionId,
      params.path,
      params.lines,
      params.createIfMissing,
      params.state,
    );
    logger.info("Lines ensured in file", {
      sessionId: params.sessionId,
      path: params.path,
      state: params.state,
    });
    return result;
  }

  private async applyPatch(args: unknown): Promise<unknown> {
    const params = PatchApplySchema.parse(args);
    const result = await this.deps.ensureService.applyPatch(
      params.sessionId,
      params.path,
      params.diff,
    );
    logger.info("Patch applied", {
      sessionId: params.sessionId,
      path: params.path,
    });
    return result;
  }
}
