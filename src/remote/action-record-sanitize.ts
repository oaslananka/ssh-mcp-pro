import type { RemoteToolName } from "./types.js";

/** Keep managed process command and stdin payloads out of durable action metadata. */
export function safeStoredActionArgs(
  tool: RemoteToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (tool === "process_start") return { ...args, command: "[redacted]" };
  if (tool === "process_input") return { ...args, input: "[redacted]" };
  return args;
}
