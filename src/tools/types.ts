import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolProvider {
  readonly namespace: string;
  getTools(): Tool[];
  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined;
}

export type ToolCallResult = CallToolResult;

export interface ToolErrorResponse extends Record<string, unknown> {
  error: true;
  code: string;
  message: string;
  hint?: string;
  recoverable?: boolean;
  suggestedAction?: string;
}
