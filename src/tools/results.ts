import type { TextContent } from "@modelcontextprotocol/server";
import type { ToolCallResult } from "./types.js";

export type StructuredContent = Record<string, unknown>;

export function toolResult(
  structuredContent: StructuredContent,
  text = JSON.stringify(structuredContent, null, 2),
): ToolCallResult {
  const content: TextContent[] = [{ type: "text", text }];
  return { content, structuredContent };
}
