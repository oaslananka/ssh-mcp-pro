#!/usr/bin/env node
import { capture, failFromResult } from "./lib/command.mjs";
import { conventionalTitleHint, isConventionalTitle } from "./lib/conventional-title.mjs";

const range = process.argv[2] ?? process.env.COMMIT_RANGE;
const subjects = range ? commitSubjects(["log", "--format=%s", range]) : defaultSubjects();
const invalid = subjects.filter((subject) => !isConventionalTitle(subject));

if (invalid.length > 0) {
  console.error(invalid.map((subject) => `invalid commit subject: ${subject}`).join("\n"));
  throw new Error(conventionalTitleHint());
}

console.log(`lint-commits: validated ${subjects.length} commit subject(s).`);

function defaultSubjects() {
  const branchSubjects = commitSubjects(["log", "--format=%s", "origin/main..HEAD"], {
    allowEmpty: true,
  });
  return branchSubjects.length > 0 ? branchSubjects : commitSubjects(["log", "-1", "--format=%s"]);
}

function commitSubjects(args, { allowEmpty = false } = {}) {
  const result = capture("git", args);
  if (result.status !== 0) {
    failFromResult(result, "git");
  }
  const subjects = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (subjects.length === 0 && !allowEmpty) {
    throw new Error("No commit subjects found to lint.");
  }
  return subjects;
}
