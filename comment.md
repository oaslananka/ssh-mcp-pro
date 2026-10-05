## Fixed Docker build and smoke image CI failure on PR #49

### Root Cause
The CI failure was caused by a HIGH severity vulnerability (CVE-2026-14456) in OpenSSL 3.5.7-r0 present in the pinned base image `node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`. The Trivy scan with `--ignore-unfixed --exit-code 1` was failing because a fix (3.5.8-r0) was available but not present in the pinned image.

### Changes Made
1. **Dockerfile** - Updated both build and runtime stage base image digests from `sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd` to `sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`, which includes OpenSSL 3.5.8-r0 (Alpine 3.24.2).

2. **test/unit/supply-chain-policy.test.ts** - Updated the test to expect the new base image digest.

### Verification Results
All acceptance criteria verified locally:

- ✅ **Docker build** - Succeeds with `--frozen-lockfile` installations in both build and runtime stages
- ✅ **CLI smoke tests** - `--version` and `--help` commands succeed cleanly
- ✅ **Image metadata labels** - All OCI labels verified (title, source, documentation, licenses, revision)
- ✅ **Trivy vulnerability scan** - Zero CRITICAL/HIGH vulnerabilities with `--ignore-unfixed`
- ✅ **Multi-platform build check** - `docker buildx build --check --platform linux/amd64,linux/arm64` passes
- ✅ **Quality gates** - `pnpm run check:quality` passes (format, lint, typecheck, audit, licenses)
- ✅ **Unit tests** - `pnpm run test` passes (603 tests, 82 test files)
- ✅ **Lockfile sync** - `pnpm install --frozen-lockfile` succeeds (already up to date)

### Files Changed (uncommitted)
- `Dockerfile`
- `test/unit/supply-chain-policy.test.ts`

Ready for the trusted publisher to update PR #49.
