## Root Cause Analysis and Fixes for PR #50 Failures

### Failed Jobs Identified
1. **Quality Gates** (duplicate reports) - `pnpm audit --audit-level moderate` failing due to npm vulnerabilities
2. **Build and smoke image** (docker.yml) - Trivy scan finding fixable HIGH/CRITICAL vulnerabilities in Docker image
3. **Quality Gates** (duplicate) - Same as #1

### Root Causes

#### 1. Quality Gates - npm audit failures
The `pnpm audit --audit-level moderate` command was failing with 24 vulnerabilities across multiple severity levels:
- **Critical/High**: `@grpc/grpc-js@1.14.4`, `brace-expansion@<5.0.11`, `nanoid@<3.3.18`
- **Moderate**: `hono@<4.13.7`, `postcss@<=8.5.22`, `qs@<=6.15.3`, `vitest@<4.1.11`, `source-map-js@<1.2.2`, `proxy-addr@2.0.7`, `markdown-it@<14.3.1`

These were transitive vulnerabilities in devDependencies (stryker-mutator, vitest, typedoc) and dependencies (@modelcontextprotocol/sdk → express → proxy-addr, @opentelemetry → @grpc/grpc-js).

#### 2. Docker Image - Trivy scan failures
The Docker image had fixable vulnerabilities:
- **Alpine OS**: `libcrypto3`/`libssl3` CVE-2026-14456 (HIGH) - fixed in Alpine 3.24.2 (openssl 3.5.8-r0)
- **Node.js packages**: `@grpc/grpc-js@1.14.4` (HIGH), `proxy-addr@2.0.7` (CRITICAL)

#### 3. Expired audit exception
The packed consumer audit exception for `GHSA-frvp-7c67-39w9` (@hono/node-server) had expired on 2026-08-23.

### Fixes Applied

#### Dockerfile
- Updated base image from `node:24-alpine@sha256:a0b9bf06e4e6...` to `node:24-alpine@sha256:ebfe2f904627...` (Alpine 3.24.2 with openssl 3.5.8-r0)

#### package.json
- Updated `@modelcontextprotocol/sdk` from `^1.29.0` to `^1.32.0` (now accepts @hono/node-server >=2.0.5)
- Updated `@opentelemetry/sdk-node` from `^0.221.0` to `^0.222.0`
- Updated `@opentelemetry/exporter-trace-otlp-http` from `^0.221.0` to `^0.222.0`
- Updated `@opentelemetry/resources` from `^2.10.0` to `^2.11.0`
- Updated devDependencies: vitest `^4.1.9` → `^4.1.11`, eslint `^10.5.0` → `^10.12.0`, knip `^6.18.0` → `^6.39.0`, prettier `^3.8.4` → `^3.9.9`, typescript-eslint `^8.62.0` → `^8.71.0`, @vitest/coverage-v8 `^4.1.9` → `^4.1.11`, plus minor type updates

#### pnpm-workspace.yaml (overrides)
Added/updated overrides to pin fixed versions of transitive vulnerabilities:
- `@grpc/grpc-js`: `^1.14.5` (was 1.14.4)
- `proxy-addr`: `^2.0.8` (was 2.0.7)
- `brace-expansion`: `^5.0.12` (was ^5.0.7)
- `hono`: `^4.13.7` (was ^4.12.27)
- `postcss`: `^8.5.23` (was >=8.5.18)
- `qs`: `^6.16.0` (was ^6.15.2)
- `vitest`: `^4.1.11`
- `@vitest/mocker`: `^4.1.11`
- `source-map-js`: `^1.2.2`
- `nanoid`: `^3.3.18` (was ^3.3.9)
- `markdown-it`: `^14.3.1`

#### docs/security/dependency-audit-exceptions.json
- Removed expired exception for `GHSA-frvp-7c67-39w9` (@hono/node-server) - no longer needed since @modelcontextprotocol/sdk@1.32.0 accepts @hono/node-server >=2.0.5 and workspace override forces 2.x

#### test/unit/supply-chain-policy.test.ts
- Updated Dockerfile SHA expectations to match new base image

### Validation Results
All checks pass:
- ✅ `pnpm run check:quality` (format, lint, typecheck, audit, licenses)
- ✅ `pnpm run test` (603 unit tests pass)
- ✅ `pnpm run check:package` (build, sync-version, validate, docs, pack, install-smoke, audit:packed)
- ✅ `pnpm install --frozen-lockfile --ignore-scripts`
- ✅ Docker build with new base image
- ✅ Docker smoke tests (`--version`, `--help`)
- ✅ Docker image labels (OCI labels correct)
- ✅ Trivy scan: **0 HIGH/CRITICAL vulnerabilities** (fixable or unfixed)

### Notes
- No checks were disabled, no audit thresholds lowered, no unjustified vulnerability exceptions added
- Dependency security remediation from PR #50 preserved and enhanced
- All changes are replay-safe working-tree changes for the trusted publisher