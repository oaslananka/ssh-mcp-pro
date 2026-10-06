## Fix Summary for PR #51 (ENG-483) and PR #50 Security Remediation

### Issues Diagnosed
The CI failures on PR #51 were caused by **npm audit vulnerabilities** in transitive dependencies, primarily from `@modelcontextprotocol/sdk` pulling in vulnerable versions of `hono`, `express`, `qs`, and other packages. The Quality Gates job failed on `pnpm audit --audit-level moderate`, and the expired audit exception for `GHSA-frvp-7c67-39w9` (`@hono/node-server`) blocked the package validation step.

Additionally, PR #50 security remediation addressed:
1. **Quality Gates** - `pnpm audit --audit-level moderate` failing due to npm vulnerabilities (24 vulnerabilities across multiple severity levels)
2. **Build and smoke image** (docker.yml) - Trivy scan finding fixable HIGH/CRITICAL vulnerabilities in Docker image
3. **Expired audit exception** for `GHSA-frvp-7c67-39w9` (@hono/node-server) expired 2026-08-23

### Changes Made

#### 1. `Dockerfile` - Updated base image (from PR #50)
- Updated base image from `node:24-alpine@sha256:a0b9bf06e4e6...` to `node:24-alpine@sha256:ebfe2f904627...` (Alpine 3.24.2 with openssl 3.5.8-r0) to fix CVE-2026-14456 (HIGH) in libcrypto3/libssl3

#### 2. `package.json` - Updated direct dependencies (merged from both PRs)
- `@modelcontextprotocol/sdk`: ^1.29.0 → ^1.32.0 (now accepts @hono/node-server >=2.0.5)
- `@opentelemetry/sdk-node`: ^0.221.0 → ^0.222.0
- `@opentelemetry/exporter-trace-otlp-http`: ^0.221.0 → ^0.222.0
- `@opentelemetry/resources`: ^2.10.0 → ^2.11.0
- Updated devDependencies: vitest ^4.1.9 → ^4.1.11, eslint ^10.5.0 → ^10.12.0, knip ^6.18.0 → ^6.39.0, prettier ^3.8.4 → ^3.9.9, typescript-eslint ^8.62.0 → ^8.71.0, @vitest/coverage-v8 ^4.1.9 → ^4.1.11, plus minor type updates (@types/ssh2 ^1.15.5 → ^1.15.6, @types/ws ^8.18.1 → ^8.18.2)

#### 3. `pnpm-workspace.yaml` - Updated dependency overrides (merged from both PRs)
Added/updated overrides to pin vulnerable transitive dependencies to patched versions:
- `@grpc/grpc-js`: ^1.14.5 (was 1.14.4) - fixes HIGH vulnerability
- `@hono/node-server`: ^2.0.5 - ensures compatible version
- `@ungap/structured-clone`: ^1.3.1
- `@vitest/mocker`: ^4.1.11
- `babel-plugin-istanbul`: ^8.0.0
- `body-parser`: ^2.3.0
- `brace-expansion`: ^5.0.12 (was ^5.0.7) - fixes quadratic expansion DoS
- `browserslist`: ^4.28.7 (fixes 3 CVEs: unbounded memory growth, prototype pollution, crash)
- `express-rate-limit`: ^8.5.1
- `fast-uri`: ^3.1.8
- `glob`: ^13.0.6
- `hono`: ^4.13.7 (was ^4.12.27) - fixes 7 CVEs including XSS, DoS, path traversal
- `ip-address`: ^10.7.1 (was ^10.2.0) - fixes 4 CVEs including SSRF, DoS
- `linkify-it`: ^5.0.2
- `markdown-it`: ^14.3.1 (fixes quadratic complexity DoS)
- `nanoid`: ^3.3.18 (was ^3.3.9) - fixes infinite loop DoS
- `postcss`: ^8.5.23 (was >=8.5.18) - fixes sourceMappingURL arbitrary file read
- `proxy-addr`: ^2.0.8 (was 2.0.7) - fixes IP spoofing via IPv4-mapped IPv6
- `qs`: ^6.16.0 (was ^6.15.2) - fixes 2 DoS CVEs
- `@protobufjs/utf8`: ^1.1.1
- `protobufjs`: ^7.6.5
- `smol-toml`: ^1.8.1 (fixes quadratic parse DoS)
- `source-map-js`: ^1.2.2 (fixes event-loop DoS via indexed source-map)
- `test-exclude`: ^8.0.0
- `uuid`: ^11.1.0
- `vitest`: ^4.1.11
- `form-data@>=4.0.0`: ^4.0.6
- `esbuild@>=0.24.0`: ^0.28.1
- `baseline-browser-mapping`: ^2.11.0 (fixes process termination DoS)

#### 4. `docs/security/dependency-audit-exceptions.json` - Removed expired exception
The exception for `GHSA-frvp-7c67-39w9` (expired 2026-08-23) was removed because the new overrides now resolve the `@hono/node-server` vulnerability in the packed consumer as well (verified by `npm audit --omit=dev` on the packed tarball showing 0 vulnerabilities).

#### 5. `pnpm-lock.yaml` - Regenerated
Updated via `pnpm install --no-frozen-lockfile --ignore-scripts` to reflect all override changes.

#### 6. `test/unit/supply-chain-policy.test.ts` - Updated Dockerfile SHA expectations (from PR #50)
- Updated Dockerfile SHA expectations to match new base image

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
- ✅ Trivy scan: **0 HIGH/CRITICAL vulnerabilities** (fixable or unfixed)

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
All moderate/high/critical vulnerabilities have been remediated via transitive dependency overrides and base image updates. The project maintains secure runtime defaults and the security fixes from both PR #50 and PR #51 are preserved.

### Notes
- No checks were disabled, no audit thresholds lowered, no unjustified vulnerability exceptions added
- Dependency security remediation from PR #50 preserved and enhanced
- All changes are replay-safe working-tree changes for the trusted publisher