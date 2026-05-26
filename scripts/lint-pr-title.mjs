#!/usr/bin/env node
import { capture } from "./lib/command.mjs";
import { conventionalTitleHint, isConventionalTitle } from "./lib/conventional-title.mjs";

const title =
  titleFromArgs(process.argv.slice(2)) ?? titleFromEnv() ?? titleFromGh() ?? titleFromGit();

if (!isConventionalTitle(title)) {
  console.error(`invalid PR title: ${title}`);
  throw new Error(conventionalTitleHint());
}

console.log(`lint-pr-title: ${title}`);

function titleFromArgs(args) {
  const titleIndex = args.indexOf("--title");
  if (titleIndex >= 0) {
    return args[titleIndex + 1];
  }
  return args.length > 0 ? args.join(" ") : undefined;
}

function titleFromEnv() {
  return process.env.PR_TITLE ?? process.env.GITHUB_PR_TITLE;
}

function titleFromGh() {
  const result = capture("gh", ["pr", "view", "--json", "title", "--jq", ".title"]);
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function titleFromGit() {
  const result = capture("git", ["log", "-1", "--format=%s"]);
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new Error("Unable to discover a PR title from args, env, gh, or git.");
  }
  return result.stdout.trim();
}
