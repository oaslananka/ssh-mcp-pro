#!/usr/bin/env node
import { capture, failFromResult } from "./lib/command.mjs";

const pr = currentPullRequest();
if (!pr) {
  console.log("check-review-threads: no pull request context; skipping.");
  process.exit(0);
}

const repo = currentRepository();
const threads = reviewThreads(repo, pr.number);
const unresolved = threads.filter((thread) => !thread.isResolved);
if (unresolved.length > 0) {
  console.error(
    unresolved
      .map((thread) => `unresolved review thread: ${thread.path ?? "unknown"}:${thread.line ?? ""}`)
      .join("\n"),
  );
  throw new Error(`PR #${pr.number} has unresolved review thread(s).`);
}

console.log(`check-review-threads: PR #${pr.number} has no unresolved review threads.`);

function currentPullRequest() {
  const result = capture("gh", ["pr", "view", "--json", "number,url"]);
  if (result.status !== 0) {
    return undefined;
  }
  return JSON.parse(result.stdout);
}

function currentRepository() {
  const result = capture("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  if (result.status !== 0) {
    failFromResult(result, "gh repo view");
  }
  const [owner, name] = result.stdout.trim().split("/");
  return { owner, name };
}

function reviewThreads(repo, number) {
  const query = `query($owner:String!, $name:String!, $number:Int!) {
    repository(owner:$owner, name:$name) {
      pullRequest(number:$number) {
        reviewThreads(first:100) {
          nodes { isResolved path line }
        }
      }
    }
  }`;
  const result = capture("gh", [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${repo.owner}`,
    "-F",
    `name=${repo.name}`,
    "-F",
    `number=${number}`,
  ]);
  if (result.status !== 0) {
    failFromResult(result, "gh api graphql");
  }
  return JSON.parse(result.stdout).data.repository.pullRequest.reviewThreads.nodes;
}
