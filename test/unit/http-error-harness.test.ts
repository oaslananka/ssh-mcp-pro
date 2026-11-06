import type { ServerResponse } from "node:http";
import { describe, expect, test } from "vitest";
import { writeTestHttpError } from "../helpers/http-error.js";

function serialize(error: unknown) {
  let status: number | undefined;
  let payload: string | undefined;
  const res = {
    writeHead: (value: number) => {
      status = value;
    },
    end: (value: string) => {
      payload = value;
    },
  } as unknown as ServerResponse;

  writeTestHttpError(res, error);
  return { status, payload, body: JSON.parse(payload ?? "{}") as Record<string, unknown> };
}

describe("integration harness HTTP error handling", () => {
  test("does not expose exception messages or stack traces", () => {
    const stackMarker = "internal error stack frame marker";
    const error = Object.assign(new Error(stackMarker), { status: 500, code: "INTERNAL_ERROR" });
    error.stack = "Error: " + stackMarker + "\n  at privateFunction (" + stackMarker + ")";

    const result = serialize(error);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Internal server error", code: "INTERNAL_ERROR" });
    expect(result.payload).not.toContain(stackMarker);
  });

  test("preserves safe client error status and code without reflecting a message", () => {
    const result = serialize({
      status: 400,
      code: "PKCE_VALIDATION_FAILED",
      message: "private runtime detail",
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Request rejected", code: "PKCE_VALIDATION_FAILED" });
    expect(result.payload).not.toContain("private runtime detail");
  });

  test("clamps malformed statuses and discards unsafe error codes", () => {
    const result = serialize({
      status: 200,
      code: "PRIVATE_STACK\n at secret",
      message: "private runtime detail",
    });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Internal server error" });
  });
});
