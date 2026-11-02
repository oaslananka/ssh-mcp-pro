import { Readable } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { readJsonOrForm } from "../../src/remote/http-util.js";
import { formDecode, jsonResponse, parseList, userSafeError } from "../../src/remote/util.js";

describe("remote utility helpers", () => {
  test("accepts scalar JSON form fields but rejects nested values", async () => {
    const request = (value: unknown) =>
      Object.assign(Readable.from([JSON.stringify(value)]), {
        headers: { "content-type": "application/json" },
      }) as never;
    await expect(
      readJsonOrForm(request({ count: 23, enabled: true, empty: null })),
    ).resolves.toEqual({
      count: "23",
      enabled: "true",
      empty: "",
    });
    await expect(readJsonOrForm(request({ code: { nested: "invalid" } }))).rejects.toMatchObject({
      code: "INVALID_CLIENT",
      status: 400,
    });
    await expect(readJsonOrForm(request({ code: ["invalid"] }))).rejects.toMatchObject({
      code: "INVALID_CLIENT",
      status: 400,
    });
  });

  test("parses comma and newline separated lists while trimming blanks", () => {
    expect(parseList(undefined)).toEqual([]);
    expect(parseList(" alpha, beta\n\ngamma ,, ")).toEqual(["alpha", "beta", "gamma"]);
  });

  test("writes formatted JSON responses with merged headers", () => {
    const writes: unknown[] = [];
    const response = {
      writeHead: vi.fn((status: number, headers: Record<string, string>) => {
        writes.push({ status, headers });
      }),
      end: vi.fn((body: string) => {
        writes.push(body);
      }),
    };

    jsonResponse(response as never, 202, { ok: true }, { "Cache-Control": "no-store" });

    expect(response.writeHead).toHaveBeenCalledWith(202, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    expect(response.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2));
    expect(writes).toHaveLength(2);
  });

  test("rejects duplicate form fields instead of silently overwriting", () => {
    expect(() => formDecode("code=first&code=second")).toThrow("Duplicate form parameter");
  });

  test("decodes unique form fields", () => {
    expect(formDecode("grant_type=authorization_code&code=abc")).toEqual({
      grant_type: "authorization_code",
      code: "abc",
    });
  });

  test("formats plain safe error objects with code and message", () => {
    expect(userSafeError({ code: "INVALID_TOKEN", message: "Authorization failed" })).toBe(
      "INVALID_TOKEN: Authorization failed",
    );
  });

  test("formats Error, message-only objects, and primitive fallback values", () => {
    expect(userSafeError(new Error("plain failure"))).toBe("plain failure");
    expect(userSafeError({ message: "message only" })).toBe("message only");
    expect(userSafeError(404)).toBe("404");
  });
});
