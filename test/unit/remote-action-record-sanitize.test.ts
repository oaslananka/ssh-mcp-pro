import { describe, expect, test } from "vitest";
import { safeStoredActionArgs } from "../../src/remote/action-record-sanitize.js";

describe("managed process action record sanitization", () => {
  test("removes stdin content from durable action records without modifying the dispatch args", () => {
    const args = {
      agent_id_or_alias: "device",
      process_id: "proc_fixture",
      input: "secret-input",
      close_stdin: true,
    };
    expect(safeStoredActionArgs("process_input", args)).toEqual({
      ...args,
      input: "[redacted]",
    });
    expect(args.input).toBe("secret-input");
  });

  test("does not persist the raw managed command in action records", () => {
    const args = {
      agent_id_or_alias: "device",
      command: "echo sensitive",
      max_runtime_seconds: 60,
    };
    expect(safeStoredActionArgs("process_start", args)).toEqual({
      ...args,
      command: "[redacted]",
    });
  });

  test("preserves non-managed action arguments", () => {
    const args = { path: "/tmp/config", old_text: "from", new_text: "to" };
    expect(safeStoredActionArgs("file_replace", args)).toEqual(args);
  });
});
