import type { Tool } from "@modelcontextprotocol/sdk/types.js";

type ToolAnnotation = NonNullable<Tool["annotations"]>;

export function objectOutputSchema(description: string): Tool["outputSchema"] {
  return {
    type: "object",
    description,
    additionalProperties: true,
  };
}

export function annotate({
  title,
  readOnly,
  destructive,
  idempotent,
  openWorld = true,
}: {
  title: string;
  readOnly: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
}): ToolAnnotation {
  return {
    title,
    readOnlyHint: readOnly,
    destructiveHint: destructive ?? !readOnly,
    idempotentHint: idempotent ?? false,
    openWorldHint: openWorld,
  };
}
