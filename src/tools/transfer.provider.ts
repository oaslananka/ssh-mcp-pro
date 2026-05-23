import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logging.js";
import type { TransferService } from "../transfer.js";
import { FileDownloadSchema, FileUploadSchema } from "../types.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

export interface TransferToolProviderDeps {
  transferService: TransferService;
}

export class TransferToolProvider implements ToolProvider {
  readonly namespace = "transfer";

  constructor(private readonly deps: TransferToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "file_upload",
        description: "Uploads a local file to the remote host over SFTP",
        annotations: annotate({
          title: "Upload File",
          readOnly: false,
          destructive: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Upload result with integrity details"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            localPath: { type: "string", description: "Local file path" },
            remotePath: { type: "string", description: "Remote file path" },
          },
          required: ["sessionId", "localPath", "remotePath"],
        },
      },
      {
        name: "file_download",
        description: "Downloads a remote file to the local machine over SFTP",
        annotations: annotate({
          title: "Download File",
          readOnly: true,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Download result with integrity details"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            remotePath: { type: "string", description: "Remote file path" },
            localPath: { type: "string", description: "Local file path" },
          },
          required: ["sessionId", "remotePath", "localPath"],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "file_upload":
        return this.upload(args);
      case "file_download":
        return this.download(args);
      default:
        return undefined;
    }
  }

  private async upload(args: unknown): Promise<unknown> {
    const params = FileUploadSchema.parse(args);
    const result = await this.deps.transferService.uploadFileWithProgress(
      params.localPath,
      params.remotePath,
      { sessionId: params.sessionId },
    );
    logger.info("File uploaded", {
      sessionId: params.sessionId,
      localPath: params.localPath,
      remotePath: params.remotePath,
    });
    return result;
  }

  private async download(args: unknown): Promise<unknown> {
    const params = FileDownloadSchema.parse(args);
    const result = await this.deps.transferService.downloadFileWithProgress(
      params.remotePath,
      params.localPath,
      { sessionId: params.sessionId },
    );
    logger.info("File downloaded", {
      sessionId: params.sessionId,
      remotePath: params.remotePath,
      localPath: params.localPath,
    });
    return result;
  }
}
