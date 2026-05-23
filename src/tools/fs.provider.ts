import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logging.js";
import type { FsService } from "../fs-tools.js";
import {
  FSListSchema,
  FSPathSchema,
  FSReadSchema,
  FSRenameSchema,
  FSStatSchema,
  FSWriteSchema,
} from "../types.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

export interface FsToolProviderDeps {
  fsService: FsService;
}

export class FsToolProvider implements ToolProvider {
  readonly namespace = "fs";

  constructor(private readonly deps: FsToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "fs_read",
        description: "Reads a file from the remote system",
        annotations: annotate({
          title: "Read Remote File",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Remote file content wrapped as structured content"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "File path to read" },
            encoding: {
              type: "string",
              description: "File encoding (default: utf8)",
            },
            maxBytes: {
              type: "number",
              description: "Optional per-request read size limit in bytes",
            },
          },
          required: ["sessionId", "path"],
        },
      },
      {
        name: "fs_write",
        description: "Writes data to a file on the remote system",
        annotations: annotate({
          title: "Write Remote File",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("File write result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "File path to write" },
            data: { type: "string", description: "Data to write to file" },
            mode: { type: "number", description: "File permissions mode" },
          },
          required: ["sessionId", "path", "data"],
        },
      },
      {
        name: "fs_stat",
        description: "Gets file or directory statistics",
        annotations: annotate({
          title: "Stat Remote Path",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Remote path stat result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "Path to stat" },
          },
          required: ["sessionId", "path"],
        },
      },
      {
        name: "fs_list",
        description: "Lists directory contents",
        annotations: annotate({
          title: "List Remote Directory",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Remote directory entries"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "Directory path to list" },
            page: { type: "number", description: "Page number for pagination" },
            limit: {
              type: "number",
              description: "Maximum items per page (default: 100)",
            },
          },
          required: ["sessionId", "path"],
        },
      },
      {
        name: "fs_mkdirp",
        description: "Creates directories recursively",
        annotations: annotate({
          title: "Create Remote Directories",
          readOnly: false,
          destructive: false,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Directory creation result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "Directory path to create" },
          },
          required: ["sessionId", "path"],
        },
      },
      {
        name: "fs_rmrf",
        description: "Removes files or directories recursively",
        annotations: annotate({
          title: "Remove Remote Path Recursively",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Recursive remove result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            path: { type: "string", description: "Path to remove" },
          },
          required: ["sessionId", "path"],
        },
      },
      {
        name: "fs_rename",
        description: "Renames or moves a file/directory",
        annotations: annotate({
          title: "Rename Remote Path",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Rename result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            from: { type: "string", description: "Source path" },
            to: { type: "string", description: "Destination path" },
          },
          required: ["sessionId", "from", "to"],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "fs_read":
        return this.read(args);
      case "fs_write":
        return this.write(args);
      case "fs_stat":
        return this.stat(args);
      case "fs_list":
        return this.list(args);
      case "fs_mkdirp":
        return this.mkdirp(args);
      case "fs_rmrf":
        return this.rmrf(args);
      case "fs_rename":
        return this.rename(args);
      default:
        return undefined;
    }
  }

  private async read(args: unknown): Promise<unknown> {
    const params = FSReadSchema.parse(args);
    const result = await this.deps.fsService.readFile(
      params.sessionId,
      params.path,
      params.encoding,
      params.maxBytes,
    );
    logger.info("File read", { sessionId: params.sessionId, path: params.path });
    return result;
  }

  private async write(args: unknown): Promise<unknown> {
    const params = FSWriteSchema.parse(args);
    const result = await this.deps.fsService.writeFile(
      params.sessionId,
      params.path,
      params.data,
      params.mode,
    );
    logger.info("File written", {
      sessionId: params.sessionId,
      path: params.path,
    });
    return result;
  }

  private async stat(args: unknown): Promise<unknown> {
    const params = FSStatSchema.parse(args);
    const result = await this.deps.fsService.statFile(params.sessionId, params.path);
    logger.info("Path stat", { sessionId: params.sessionId, path: params.path });
    return result;
  }

  private async list(args: unknown): Promise<unknown> {
    const params = FSListSchema.parse(args);
    const result = await this.deps.fsService.listDirectory(
      params.sessionId,
      params.path,
      params.page,
      params.limit,
    );
    logger.info("Directory listed", {
      sessionId: params.sessionId,
      path: params.path,
    });
    return result;
  }

  private async mkdirp(args: unknown): Promise<unknown> {
    const params = FSPathSchema.parse(args);
    const result = await this.deps.fsService.makeDirectories(params.sessionId, params.path);
    logger.info("Directories created", {
      sessionId: params.sessionId,
      path: params.path,
    });
    return result;
  }

  private async rmrf(args: unknown): Promise<unknown> {
    const params = FSPathSchema.parse(args);
    const result = await this.deps.fsService.removeRecursive(params.sessionId, params.path);
    logger.info("Path removed", {
      sessionId: params.sessionId,
      path: params.path,
    });
    return result;
  }

  private async rename(args: unknown): Promise<unknown> {
    const params = FSRenameSchema.parse(args);
    const result = await this.deps.fsService.renameFile(params.sessionId, params.from, params.to);
    logger.info("Path renamed", {
      sessionId: params.sessionId,
      from: params.from,
      to: params.to,
    });
    return result;
  }
}
