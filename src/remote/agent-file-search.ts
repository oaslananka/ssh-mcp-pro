import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { isPathAllowed } from "./policy.js";
import type { AgentPolicy } from "./types.js";

export interface FileSearchInput {
  name_pattern: string;
  root_path?: string;
  max_depth?: number;
  max_results?: number;
  include_hidden?: boolean;
}

export interface FileSearchResult {
  matches: Array<{ name: string; path: string }>;
  truncated: boolean;
  scanned_entries: number;
}

const MAX_SCAN_ENTRIES = 2_000;
const MAX_SCAN_DIRECTORIES = 128;

function denied(message: string): Error {
  return Object.assign(new Error(message), { code: "POLICY_DENIED" as const });
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw denied(`Expected an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function filenameMatcher(pattern: string): (filename: string) => boolean {
  const query = pattern.toLocaleLowerCase();
  if (!query.includes("*") && !query.includes("?")) {
    return (name) => name.toLocaleLowerCase().includes(query);
  }
  // Linear wildcard matching: avoid exponential regex backtracking on user input.
  return (name) => {
    const candidate = name.toLocaleLowerCase();
    let nameIndex = 0;
    let patternIndex = 0;
    let lastStar = -1;
    let retryNameIndex = 0;
    while (nameIndex < candidate.length) {
      if (
        patternIndex < query.length &&
        (query[patternIndex] === "?" || query[patternIndex] === candidate[nameIndex])
      ) {
        nameIndex += 1;
        patternIndex += 1;
      } else if (patternIndex < query.length && query[patternIndex] === "*") {
        lastStar = patternIndex++;
        retryNameIndex = nameIndex;
      } else if (lastStar !== -1) {
        patternIndex = lastStar + 1;
        nameIndex = ++retryNameIndex;
      } else {
        return false;
      }
    }
    while (query[patternIndex] === "*") patternIndex += 1;
    return patternIndex === query.length;
  };
}

/**
 * Bounded, filename-only discovery inside an agent's local file-read policy.
 * No file content is accessed. Symlinks are never traversed or returned.
 */
export async function searchAuthorizedFileNames(
  policy: AgentPolicy,
  args: FileSearchInput,
): Promise<FileSearchResult> {
  const pattern = args.name_pattern;
  if (
    typeof pattern !== "string" ||
    pattern.length < 1 ||
    pattern.length > 100 ||
    /[/\\]/u.test(pattern)
  ) {
    throw denied("name_pattern must be a filename pattern of 1-100 characters");
  }
  if (args.include_hidden !== undefined && typeof args.include_hidden !== "boolean") {
    throw denied("include_hidden must be a boolean");
  }
  if (
    args.root_path !== undefined &&
    (typeof args.root_path !== "string" ||
      args.root_path.length < 1 ||
      args.root_path.length > 4096)
  ) {
    throw denied("root_path must be a nonempty path");
  }
  const maxDepth = boundedInteger(args.max_depth, 3, 0, 5);
  const maxResults = boundedInteger(args.max_results, 20, 1, 50);
  const matchName = filenameMatcher(pattern);
  const roots = args.root_path === undefined ? policy.allowPaths : [args.root_path];
  if (roots.length > 32) throw denied("Too many search roots configured by local policy");
  const queue: Array<{ root: string; directory: string; depth: number }> = [];

  for (const requested of roots) {
    if (!isPathAllowed(policy, requested)) {
      if (args.root_path !== undefined) throw denied("Search root is not allowed by local policy");
      continue;
    }
    try {
      const rootInfo = await lstat(requested);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        if (args.root_path !== undefined) throw denied("Search root must be a regular directory");
        continue;
      }
      const canonical = await realpath(requested);
      if (!isPathAllowed(policy, canonical)) {
        if (args.root_path !== undefined)
          throw denied("Search root is not allowed by local policy");
        continue;
      }
      if (!queue.some((entry) => entry.root === canonical)) {
        queue.push({ root: canonical, directory: canonical, depth: 0 });
      }
    } catch (error) {
      if (args.root_path !== undefined)
        throw denied("Search root is unavailable under local policy");
      if (error && typeof error === "object" && "code" in error && error.code === "POLICY_DENIED")
        throw error;
    }
  }

  if (!queue.length) throw denied("No accessible search roots are configured by local policy");

  const matches: FileSearchResult["matches"] = [];
  let scannedEntries = 0;
  let scannedDirectories = 0;
  let truncated = false;

  while (
    queue.length &&
    scannedEntries < MAX_SCAN_ENTRIES &&
    scannedDirectories < MAX_SCAN_DIRECTORIES &&
    matches.length < maxResults
  ) {
    const current = queue.shift()!;
    if (!isPathAllowed(policy, current.directory) || !withinRoot(current.root, current.directory))
      continue;
    let directory;
    try {
      const info = await lstat(current.directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        !withinRoot(current.root, await realpath(current.directory))
      )
        continue;
      directory = await opendir(current.directory);
    } catch {
      continue;
    }
    scannedDirectories += 1;
    for await (const entry of directory) {
      if (scannedEntries >= MAX_SCAN_ENTRIES || matches.length >= maxResults) {
        truncated = true;
        break;
      }
      scannedEntries += 1;
      if (
        entry.name === "." ||
        entry.name === ".." ||
        (!args.include_hidden && entry.name.startsWith(".")) ||
        entry.isSymbolicLink()
      )
        continue;
      const candidate = path.join(current.directory, entry.name);
      if (!isPathAllowed(policy, candidate)) continue;
      try {
        const info = await lstat(candidate);
        if (info.isSymbolicLink()) continue;
        const canonical = await realpath(candidate);
        if (!withinRoot(current.root, canonical) || !isPathAllowed(policy, canonical)) continue;
        if (info.isDirectory()) {
          if (current.depth < maxDepth)
            queue.push({ root: current.root, directory: canonical, depth: current.depth + 1 });
        } else if (info.isFile() && matchName(entry.name)) {
          matches.push({ name: entry.name, path: canonical });
        }
      } catch {
        // A directory entry can disappear while scanning; no path details escape.
      }
    }
  }
  if (
    queue.length ||
    scannedEntries >= MAX_SCAN_ENTRIES ||
    scannedDirectories >= MAX_SCAN_DIRECTORIES ||
    matches.length >= maxResults
  ) {
    truncated = true;
  }

  let result: FileSearchResult = { matches, truncated, scanned_entries: scannedEntries };
  while (
    Buffer.byteLength(JSON.stringify(result), "utf8") > policy.maxOutputBytes &&
    result.matches.length
  ) {
    result = { ...result, matches: result.matches.slice(0, -1), truncated: true };
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > policy.maxOutputBytes) {
    throw denied("Agent output limit is too small for file search results");
  }
  return result;
}
