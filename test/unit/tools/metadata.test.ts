import { describe, expect, test } from "@jest/globals";
import { annotate, objectOutputSchema } from "../../../src/tools/metadata.js";

describe("tool metadata helpers", () => {
  test("builds object output schemas with descriptions", () => {
    expect(objectOutputSchema("command result")).toEqual({
      type: "object",
      description: "command result",
      additionalProperties: true,
    });
  });

  test("applies safe annotation defaults", () => {
    expect(annotate({ title: "Read file", readOnly: true })).toEqual({
      title: "Read file",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  test("preserves explicit annotation overrides", () => {
    expect(
      annotate({
        title: "Install package",
        readOnly: false,
        destructive: false,
        idempotent: true,
        openWorld: false,
      }),
    ).toEqual({
      title: "Install package",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
