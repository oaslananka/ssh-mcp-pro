import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { httpErrorResponse, readHttpJsonBody } from "../../src/http-json-body.js";

describe("bounded HTTP JSON body", () => {
  test("accepts empty input without manufacturing a JSON value", async () => {
    await expect(readHttpJsonBody(Readable.from([]), 0)).resolves.toBeUndefined();
    await expect(readHttpJsonBody(Readable.from([""]), 0)).resolves.toBeUndefined();
  });

  test("reassembles fragmented UTF-8 and accepts the exact byte limit", async () => {
    const value = { text: "caf\u00e9" };
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    const split = bytes.indexOf(0xc3) + 1;
    await expect(
      readHttpJsonBody(
        Readable.from([bytes.subarray(0, split), bytes.subarray(split)]),
        bytes.length,
      ),
    ).resolves.toEqual(value);
  });

  test("rejects a multibyte body one byte above the limit", async () => {
    const value = JSON.stringify({ text: "\u00e9" });
    await expect(
      readHttpJsonBody(Readable.from([value]), Buffer.byteLength(value) - 1).catch(
        httpErrorResponse,
      ),
    ).resolves.toEqual({ statusCode: 413, payload: { error: "Request body is too large" } });
  });

  test.each(["{", " "])("maps invalid JSON to 400 for %j", async (value) => {
    await expect(
      readHttpJsonBody(Readable.from([value]), 16).catch(httpErrorResponse),
    ).resolves.toEqual({ statusCode: 400, payload: { error: "Invalid JSON body" } });
  });

  test("does not turn a failed input stream into a client JSON error", async () => {
    const error = new Error("internal stream failure");
    function* failedStream() {
      yield Buffer.from("{");
      throw error;
    }
    await expect(readHttpJsonBody(Readable.from(failedStream()), 16)).rejects.toBe(error);
    expect(httpErrorResponse(error)).toEqual({
      statusCode: 500,
      payload: { error: "Internal server error" },
    });
  });

  test("preserves existing explicitly mapped HTTP error status, message and code", () => {
    expect(
      httpErrorResponse({
        status: 418,
        message: "Remote boundary rejected",
        code: "REMOTE_REJECTED",
      }),
    ).toEqual({
      statusCode: 418,
      payload: { error: "Remote boundary rejected", code: "REMOTE_REJECTED" },
    });
  });
});
