import * as fs from "node:fs";
import * as path from "node:path";
import { posix as posixPath } from "node:path";

export function isSegmentBoundaryPathMatch(
  candidate: string,
  prefix: string,
  separator: string,
): boolean {
  return candidate === prefix || candidate.startsWith(`${prefix}${separator}`);
}

function stripTrailingSeparators(value: string, separator: string, root: string): string {
  let stripped = value;
  while (stripped.length > root.length && stripped.endsWith(separator)) {
    stripped = stripped.slice(0, -separator.length);
  }
  return stripped;
}

function resolveLocalExistingPrefix(normalizedPath: string): string {
  const pendingSegments: string[] = [];
  let candidate = normalizedPath;

  while (true) {
    try {
      const resolvedPrefix = fs.realpathSync.native(candidate);
      pendingSegments.reverse();
      return path.join(resolvedPrefix, ...pendingSegments);
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        return normalizedPath;
      }

      pendingSegments.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

export function normalizeRemotePosixPath(pathValue: string): string {
  if (pathValue.includes("\0")) {
    throw new Error("Path contains NUL byte");
  }

  const unixSeparators = pathValue.replaceAll("\\", "/");
  const absolutePath = unixSeparators.startsWith("/") ? unixSeparators : `/${unixSeparators}`;
  const normalized = posixPath.normalize(absolutePath);
  return stripTrailingSeparators(normalized, "/", "/");
}

export function normalizeLocalPolicyPath(pathValue: string): string {
  if (pathValue.includes("\0")) {
    throw new Error("Path contains NUL byte");
  }

  const absolutePath = path.resolve(pathValue);
  const normalized = resolveLocalExistingPrefix(path.normalize(absolutePath));

  return stripTrailingSeparators(normalized, path.sep, path.parse(normalized).root);
}

export function normalizePolicyPaths(
  paths: string[] | undefined,
  normalizer: (pathValue: string) => string,
): string[] {
  return [...new Set((paths ?? []).map((pathValue) => normalizer(pathValue)))];
}

export function isPathUnder(pathValue: string, prefix: string, separator: string): boolean {
  if (prefix === "/" || prefix === path.parse(prefix).root) {
    return true;
  }
  return isSegmentBoundaryPathMatch(pathValue, prefix, separator);
}
