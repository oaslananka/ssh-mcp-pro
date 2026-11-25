const statusKeys = new Map([
  ["Killed", "killed"],
  ["Survived", "survived"],
  ["Timeout", "timedOut"],
  ["NoCoverage", "noCoverage"],
  ["CompileError", "compileErrors"],
  ["RuntimeError", "runtimeErrors"],
  ["Ignored", "ignored"],
  ["Pending", "pending"],
]);

function emptyCounts() {
  return {
    total: 0,
    killed: 0,
    survived: 0,
    timedOut: 0,
    noCoverage: 0,
    compileErrors: 0,
    runtimeErrors: 0,
    ignored: 0,
    pending: 0,
    zeroTestMutants: 0,
    testsCompleted: 0,
  };
}

function scored(counts) {
  const detected = counts.killed + counts.timedOut;
  const denominator = detected + counts.survived + counts.noCoverage;
  return {
    ...counts,
    score: denominator === 0 ? null : (detected / denominator) * 100,
    valid:
      denominator > 0 &&
      counts.testsCompleted > 0 &&
      counts.zeroTestMutants === 0 &&
      counts.runtimeErrors === 0 &&
      counts.pending === 0,
  };
}

export function summarizeMutationReport(report) {
  if (
    report?.schemaVersion !== "1.0" ||
    !report.files ||
    typeof report.files !== "object" ||
    Array.isArray(report.files)
  ) {
    throw new Error("Missing or unsupported mutation report schema");
  }
  const totals = emptyCounts();
  const files = [];
  for (const [path, file] of Object.entries(report.files)) {
    if (!Array.isArray(file?.mutants)) throw new Error("Missing mutant list: " + path);
    const counts = emptyCounts();
    for (const mutant of file.mutants) {
      const key = statusKeys.get(mutant?.status);
      if (!key) throw new Error("Unsupported mutant status in " + path);
      counts[key]++;
      counts.total++;
      const completed = mutant.testsCompleted;
      if (Number.isSafeInteger(completed) && completed > 0) counts.testsCompleted += completed;
      if (
        (key === "killed" || key === "survived") &&
        !(Number.isSafeInteger(completed) && completed > 0)
      ) {
        counts.zeroTestMutants++;
      }
    }
    for (const key of Object.keys(totals)) totals[key] += counts[key];
    files.push({ path, ...scored(counts) });
  }
  if (totals.total === 0) throw new Error("Mutation report contains no mutants");
  return { ...scored(totals), files };
}
