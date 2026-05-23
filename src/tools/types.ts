import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolProvider {
  readonly namespace: string;
  getTools(): Tool[];
  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined;
}

export type ToolCallResult = CallToolResult;
