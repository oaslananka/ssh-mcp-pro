import { readFilePageBounded } from "./agent-bounded-io.js";
import { scanAuthorizedFiles, type AuthorizedScanResult } from "./agent-file-search.js";
import { withAuthorizedRead } from "./safe-file.js";
import type { AgentPolicy } from "./types.js";

export interface ContentSearchInput {
  query: string;
  name_pattern?: string;
  root_path?: string;
  max_depth?: number;
  max_results?: number;
  include_hidden?: boolean;
  case_sensitive?: boolean;
}

export interface ContentMatch {
  name: string;
  path: string;
  line_number: number;
  snippet: string;
}

const MAX_FILE_BYTES = 128 * 1024;
const MAX_EXAMINED_FILES = 128;

function denied(message: string): Error {
  return Object.assign(new Error(message), { code: "POLICY_DENIED" as const });
}

async function firstMatchingLine(
  policy: AgentPolicy,
  name: string,
  filePath: string,
  query: string,
  caseSensitive: boolean,
): Promise<ContentMatch | null> {
  try {
    return await withAuthorizedRead(
      policy,
      filePath,
      "Path is not allowed by local policy",
      "File content search skipped an unreadable file",
      async (file) => {
        const stat = await file.stat();
        if (stat.size > MAX_FILE_BYTES || !stat.isFile()) return null;
        // Read at most MAX_FILE_BYTES+1 bytes, never an unbounded file.readFile().
        const result = await readFilePageBounded(file, 0, MAX_FILE_BYTES);
        if (result.truncated || result.value.includes(0)) return null;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(result.value);
        const needle = caseSensitive ? query : query.toLocaleLowerCase();
        const lines = text.split(/\r?\n/u);
        for (const [index, line] of lines.entries()) {
          const haystack = caseSensitive ? line : line.toLocaleLowerCase();
          const start = haystack.indexOf(needle);
          if (start !== -1) {
            const snippet = line.slice(Math.max(0, start - 30), start + query.length + 90);
            return { name, path: filePath, line_number: index + 1, snippet };
          }
        }
        return null;
      },
    );
  } catch {
    // Unreadable, concurrently moved or invalid UTF-8 files are not exposed.
    return null;
  }
}

/** Bounded literal content search in agent-local, allowlisted regular files. */
export async function searchAuthorizedFileContents(
  policy: AgentPolicy,
  args: ContentSearchInput,
): Promise<AuthorizedScanResult<ContentMatch>> {
  if (
    typeof args.query !== "string" ||
    args.query.length < 1 ||
    args.query.length > 200 ||
    /[\r\n\u0000]/u.test(args.query)
  ) {
    throw denied("query must be a single-line literal string of 1-200 characters");
  }
  if (args.case_sensitive !== undefined && typeof args.case_sensitive !== "boolean") {
    throw denied("case_sensitive must be a boolean");
  }
  const query = args.query;
  const caseSensitive = args.case_sensitive ?? false;
  return scanAuthorizedFiles(
    policy,
    {
      name_pattern: args.name_pattern ?? "*",
      ...(args.root_path !== undefined ? { root_path: args.root_path } : {}),
      ...(args.max_depth !== undefined ? { max_depth: args.max_depth } : {}),
      ...(args.max_results !== undefined ? { max_results: args.max_results } : {}),
      ...(args.include_hidden !== undefined ? { include_hidden: args.include_hidden } : {}),
    },
    async (name, filePath) => firstMatchingLine(policy, name, filePath, query, caseSensitive),
    MAX_EXAMINED_FILES,
  );
}
