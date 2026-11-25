import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { rowString, optionalRowString } from "../../src/remote/store-row-values.js";

describe("SQLite row conversion", () => {
  test("preserves actual SQLite string, numeric, null and absent column semantics", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const row = db
        .prepare("SELECT 'fixture' AS label, 7 AS count, NULL AS absent, '' AS empty")
        .get();
      if (!row) throw new Error("Missing fixture row");
      expect(rowString(row, "label")).toBe("fixture");
      expect(rowString(row, "count")).toBe("7");
      expect(rowString(row, "absent")).toBe("");
      expect(rowString(row, "missing")).toBe("");
      expect(optionalRowString(row, "label")).toBe("fixture");
      expect(optionalRowString(row, "count")).toBeUndefined();
      expect(optionalRowString(row, "absent")).toBeUndefined();
      expect(optionalRowString(row, "empty")).toBeUndefined();
      expect(optionalRowString(row, "missing")).toBeUndefined();
      expect(() => rowString({ invalid: true }, "invalid")).toThrow(
        "Unexpected database column type",
      );
    } finally {
      db.close();
    }
  });

  test("ignores inherited properties and does not invoke property accessors", () => {
    const row: Record<string, unknown> = { own: "column" };
    Object.setPrototypeOf(row, { inherited: "not a column" });
    Object.defineProperty(row, "accessor", {
      get: () => {
        throw new Error("Accessor must not execute");
      },
    });
    expect(rowString(row, "own")).toBe("column");
    expect(rowString(row, "inherited")).toBe("");
    expect(optionalRowString(row, "inherited")).toBeUndefined();
    expect(rowString(row, "accessor")).toBe("");
    expect(optionalRowString(row, "accessor")).toBeUndefined();
    expect(rowString(row, "constructor")).toBe("");
  });
});
