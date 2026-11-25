import { describe, expect, test } from "vitest";
import { summarizeMutationReport } from "../../scripts/lib/mutation-report.mjs";

describe("mutation report evidence", () => {
  test("aggregates actual per-file mutants, excluding compile errors from the score", () => {
    const report = summarizeMutationReport({
      schemaVersion: "1.0",
      files: {
        "src/auth.ts": {
          mutants: [
            { status: "Killed", testsCompleted: 1 },
            { status: "Survived", testsCompleted: 2 },
            { status: "CompileError" },
          ],
        },
        "src/policy.ts": {
          mutants: [{ status: "Timeout" }, { status: "NoCoverage" }, { status: "Ignored" }],
        },
      },
    });
    expect(report).toMatchObject({
      total: 6,
      killed: 1,
      survived: 1,
      timedOut: 1,
      noCoverage: 1,
      compileErrors: 1,
      ignored: 1,
      score: 50,
      valid: true,
    });
    expect(report.files[0]).toMatchObject({ path: "src/auth.ts", total: 3, score: 50 });
  });

  test("does not mistake zero-test survivors for valid mutation evidence", () => {
    const result = summarizeMutationReport({
      schemaVersion: "1.0",
      files: {
        "src/auth.ts": {
          mutants: [{ status: "Survived", testsCompleted: 0 }, { status: "CompileError" }],
        },
      },
    });
    expect(result).toMatchObject({
      total: 2,
      survived: 1,
      zeroTestMutants: 1,
      valid: false,
      score: 0,
    });
  });

  test.each([
    {},
    { schemaVersion: "1.0", files: {} },
    { schemaVersion: "1.0", files: { x: { mutants: [{ status: "Unknown" }] } } },
  ])("rejects absent or unsupported evidence", (input) => {
    expect(() => summarizeMutationReport(input)).toThrow();
  });

  test("reports untested and runtime-error-only runs as invalid, not successful", () => {
    const result = summarizeMutationReport({
      schemaVersion: "1.0",
      files: { x: { mutants: [{ status: "RuntimeError" }, { status: "NoCoverage" }] } },
    });
    expect(result).toMatchObject({ total: 2, runtimeErrors: 1, noCoverage: 1, valid: false });
  });
});
