# API Stability

This project has never made an explicit stability statement before this document. It's
written now to describe intent going forward, not to claim a history of enforcement
that doesn't exist — see [docs/repo-maturity-report.md](../repo-maturity-report.md)
("API/CLI stability") for the audit that identified this gap.

## What is considered "the public API"

For SemVer purposes, going forward:

1. **MCP tool/resource/prompt schemas** exposed by the `full` profile — names, required
   parameters, and result shapes. Covered by `test/unit/mcp-contract.test.ts`.
2. **CLI flags** in `docs/reference/cli.md` (mirrors `src/cli.ts`).
3. **`SSH_MCP_*` environment variables** and their default values.
4. **The two published binaries' existence and basic invocation** (`ssh-mcp-pro`,
   `ssh-mcp-pro-agent`).

## What is explicitly not covered

- Internal module structure under `src/` (anything not re-exported).
- Exact wording of error messages and log lines.
- The shape of `SSH_MCP_POLICY_FILE` beyond what's documented — see the config-schema
  gap noted in the maturity report; this will need its own versioning story before it
  can be a stability guarantee.
- Tool profiles *other than* `full` gaining new tools without a version bump — adding a
  tool to a restricted profile is additive from that profile's consumer's perspective,
  but is still called out here as unresolved: **Needs human confirmation** on whether
  profile membership changes should be treated as SemVer-significant.

## What counts as breaking

Per Conventional Commits (`!` / `BREAKING CHANGE:` — see
[commit-conventions.md](commit-conventions.md)): removing or renaming a tool/flag/env
var, changing a tool's required parameters, changing a default value that changes
security posture (e.g. flipping a deny-by-default to allow-by-default), or removing a
supported Node.js version ahead of its own EOL.

## Current honest caveat

The project is on `1.x` but is 5 days old with zero external consumers on record. This
policy is aspirational until it's been exercised against a real breaking change and a
real major version bump — that will be the first real test of whether this document
holds up in practice.
