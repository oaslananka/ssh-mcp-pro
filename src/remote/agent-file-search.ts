import type { Dir, Dirent } from "node:fs";
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

interface SearchOptions {
  maxDepth: number;
  maxResults: number;
  includeHidden: boolean;
  matchName: (filename: string) => boolean;
}
interface SearchNode {
  root: string;
  directory: string;
  depth: number;
}
interface ScanState extends SearchOptions {
  policy: AgentPolicy;
  queue: SearchNode[];
  matches: FileSearchResult["matches"];
  scannedEntries: number;
  scannedDirectories: number;
  truncated: boolean;
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
  // Linear wildcard matching prevents regex backtracking from user input.
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

function parseOptions(args: FileSearchInput): SearchOptions {
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
  return {
    matchName: filenameMatcher(pattern),
    includeHidden: args.include_hidden ?? false,
    maxDepth: boundedInteger(args.max_depth, 3, 0, 5),
    maxResults: boundedInteger(args.max_results, 20, 1, 50),
  };
}

async function resolveRoot(
  policy: AgentPolicy,
  requested: string,
  explicit: boolean,
): Promise<string | null> {
  if (!isPathAllowed(policy, requested)) {
    if (explicit) throw denied("Search root is not allowed by local policy");
    return null;
  }
  try {
    const info = await lstat(requested);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      if (explicit) throw denied("Search root must be a regular directory");
      return null;
    }
    const canonical = await realpath(requested);
    if (!isPathAllowed(policy, canonical)) {
      if (explicit) throw denied("Search root is not allowed by local policy");
      return null;
    }
    return canonical;
  } catch {
    if (explicit) throw denied("Search root is unavailable under local policy");
    return null;
  }
}

function limitReached(state: ScanState): boolean {
  return (
    state.scannedEntries >= MAX_SCAN_ENTRIES ||
    state.scannedDirectories >= MAX_SCAN_DIRECTORIES ||
    state.matches.length >= state.maxResults
  );
}

async function inspectEntry(state: ScanState, current: SearchNode, entry: Dirent): Promise<void> {
  if (
    entry.name === "." ||
    entry.name === ".." ||
    (!state.includeHidden && entry.name.startsWith(".")) ||
    entry.isSymbolicLink()
  )
    return;
  const candidate = path.join(current.directory, entry.name);
  if (!isPathAllowed(state.policy, candidate)) return;
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) return;
    const canonical = await realpath(candidate);
    if (!withinRoot(current.root, canonical) || !isPathAllowed(state.policy, canonical)) return;
    if (info.isDirectory()) {
      if (current.depth < state.maxDepth)
        state.queue.push({ root: current.root, directory: canonical, depth: current.depth + 1 });
    } else if (info.isFile() && state.matchName(entry.name)) {
      state.matches.push({ name: entry.name, path: canonical });
    }
  } catch {
    // A directory entry may disappear while scanning; never return its path.
  }
}

async function consumeEntries(
  state: ScanState,
  current: SearchNode,
  directory: Dir,
): Promise<void> {
  if (limitReached(state)) {
    state.truncated = true;
    return;
  }
  const entry = await directory.read();
  if (!entry) return;
  state.scannedEntries += 1;
  await inspectEntry(state, current, entry);
  return consumeEntries(state, current, directory);
}

async function visitDirectory(state: ScanState, current: SearchNode): Promise<void> {
  if (
    !isPathAllowed(state.policy, current.directory) ||
    !withinRoot(current.root, current.directory)
  )
    return;
  let directory: Dir;
  try {
    const info = await lstat(current.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    const canonical = await realpath(current.directory);
    if (!withinRoot(current.root, canonical) || !isPathAllowed(state.policy, canonical)) return;
    directory = await opendir(current.directory);
  } catch {
    return;
  }
  state.scannedDirectories += 1;
  try {
    await consumeEntries(state, current, directory);
  } finally {
    await directory.close().catch(() => undefined);
  }
}

async function scanQueue(state: ScanState): Promise<void> {
  if (!state.queue.length) return;
  if (limitReached(state)) {
    state.truncated = true;
    return;
  }
  const current = state.queue.shift()!;
  await visitDirectory(state, current);
  return scanQueue(state);
}

function boundedResult(state: ScanState): FileSearchResult {
  let result: FileSearchResult = {
    matches: state.matches,
    truncated: state.truncated,
    scanned_entries: state.scannedEntries,
  };
  while (
    Buffer.byteLength(JSON.stringify(result), "utf8") > state.policy.maxOutputBytes &&
    result.matches.length
  ) {
    result = { ...result, matches: result.matches.slice(0, -1), truncated: true };
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > state.policy.maxOutputBytes) {
    throw denied("Agent output limit is too small for file search results");
  }
  return result;
}

/** A bounded, filename-only search inside agent-local approved folders. */
export async function searchAuthorizedFileNames(
  policy: AgentPolicy,
  args: FileSearchInput,
): Promise<FileSearchResult> {
  const options = parseOptions(args);
  const roots = args.root_path === undefined ? policy.allowPaths : [args.root_path];
  if (roots.length > 32) throw denied("Too many search roots configured by local policy");
  const resolved = await Promise.all(
    roots.map((root) => resolveRoot(policy, root, args.root_path !== undefined)),
  );
  const uniqueRoots = [...new Set(resolved.filter((root): root is string => root !== null))];
  if (!uniqueRoots.length)
    throw denied("No accessible search roots are configured by local policy");

  const state: ScanState = {
    ...options,
    policy,
    queue: uniqueRoots.map((root) => ({ root, directory: root, depth: 0 })),
    matches: [],
    scannedEntries: 0,
    scannedDirectories: 0,
    truncated: false,
  };
  await scanQueue(state);
  return boundedResult(state);
}
