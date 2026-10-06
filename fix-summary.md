## Fix Summary for PR #51 (ENG-483)

### Issues Diagnosed
The CI failures on PR #51 were caused by **npm audit vulnerabilities** in transitive dependencies, primarily from `@modelcontextprotocol/sdk` pulling in vulnerable versions of `hono`, `express`, `qs`, and other packages. The Quality Gates job failed on `pnpm audit --audit-level moderate`, and the expired audit exception for `GHSA-frvp-7c67-39w9` (`@hono/node-server`) blocked the package validation step.

### Changes Made

#### 1. `pnpm-workspace.yaml` - Updated dependency overrides
Added/updated overrides to pin vulnerable transitive dependencies to patched versions:
- `hono`: ^4.12.27 → ^4.13.7 (fixes 7 CVEs including XSS, DoS, path traversal)
- `ip-address`: ^10.2.0 → ^10.7.1 (fixes 4 CVEs including SSRF, DoS)
- `qs`: ^6.15.2 → ^6.16.0 (fixes 2 DoS CVEs)
- `brace-expansion`: ^5.0.7 → ^5.0.12 (fixes quadratic expansion DoS)
- `browserslist`: ^4.28.7 (fixes 3 CVEs: unbounded memory growth, prototype pollution, crash)
- `nanoid`: ^3.3.18 (fixes infinite loop DoS)
- `postcss`: ^8.5.23 (fixes sourceMappingURL arbitrary file read)
- `proxy-addr`: ^2.0.8 (fixes IP spoofing via IPv4-mapped IPv6)
- `source-map-js`: ^1.2.2 (fixes event-loop DoS via indexed source-map)
- `markdown-it`: ^14.3.1 (fixes quadratic complexity DoS)
- `smol-toml`: ^1.8.1 (fixes quadratic parse DoS)
- `baseline-browser-mapping`: ^2.11.0 (fixes process termination DoS)
- `vitest`: ^4.1.11 (fixes path traversal via @vitest/mocker)
- `@vitest/mocker`: ^4.1.11 (same)

#### 2. `package.json` - Updated direct devDependencies
- `vitest`: ^4.1.9 → ^4.1.11
- `@vitest/coverage-v8`: ^4.1.9 → ^4.1.11

#### 3. `docs/security/dependency-audit-exceptions.json` - Removed expired exception
The exception for `GHSA-frvp-7c67-39w9` (expired 2026-08-23) was removed because the new overrides now resolve the `@hono/node-server` vulnerability in the packed consumer as well (verified by `npm audit --omit=dev` on the packed tarball showing 0 vulnerabilities).

#### 4. `pnpm-lock.yaml` - Regenerated
Updated via `pnpm install --no-frozen-lockfile --ignore-scripts` to reflect all override changes.

### Validation Results

**Quality Gates (all pass):**
- ✅ format:check
- ✅ check:doc-language
- ✅ check:package-scripts
- ✅ check:rulesets
- ✅ verify:actions-runtime
- ✅ lint
- ✅ typecheck
- ✅ audit (No known vulnerabilities found)
- ✅ licenses:check

**Tests (all pass):**
- ✅ Unit: 603 tests passed
- ✅ Integration: 27 passed, 3 skipped (Windows-only)
- ✅ E2E: 11 passed

**Docker Build & Smoke (all pass):**
- ✅ `docker build -t ssh-mcp-pro:ci .` succeeds
- ✅ `docker run --rm ssh-mcp-pro:ci --version` outputs `1.2.0`
- ✅ `docker run --rm ssh-mcp-pro:ci --help` shows full CLI help
- ✅ OCI image labels verified (title, source, documentation, licenses)
- ✅ Multi-platform buildx check (`linux/amd64,linux/arm64`) passes

**Package Validation (all pass):**
- ✅ build
- ✅ sync-version
- ✅ validate:mcp-metadata
- ✅ validate:chatgpt-app
- ✅ validate:claude-connector
- ✅ docs:check
- ✅ pack:check
- ✅ pack:install-smoke
- ✅ audit:packed (0 time-bounded advisory exceptions)

### Security Posture
All moderate/high/critical vulnerabilities have been remediated via transitive dependency overrides. The project maintains secure runtime defaults and the security fixes from the original PR are preserved.