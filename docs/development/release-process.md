# Release Process

## Prepare a version

Release Please v5 prepares Conventional Commit-driven version updates on `main`. A release PR updates `CHANGELOG.md`, package, registry metadata, client readiness metadata and embedded version strings together. Merge a release PR only after the normal protected-branch checks pass.

When an unreleased version reaches `main`, the `Release` workflow preflights the **frozen dependency installation, full quality check, dependency freshness, package build, SBOM, checksums and GitHub artifact attestations** before Release Please creates the tag. It then attaches that exact prebuilt package and SBOM to the GitHub Release and dispatches an immutable-tag GHCR build. Ordinary main pushes without a new version do not repeat the heavy preflight.

## Automatic npm publication

**Merge the Release Please PR** to publish the new version automatically. After preflight checks, Release Please creates the immutable GitHub Release, attaches the verified assets, and the dependent `publish-npm` job publishes that exact artifact. No separate manual workflow or npm approval step is part of the normal path. `Actions → Release → Run workflow → main` remains available as an idempotent recovery action for a release that has already been created.

The `Publish verified GitHub Release to npm` job identifies the `package.json` version on `main`, locates its immutable GitHub Release, downloads the already-built `.tgz` and checksum, verifies the tag's source/version, checks SHA-256, package metadata and the GitHub attestation, then calls **`npm publish` directly with GitHub-hosted Actions OIDC**. A version already public on npm is not published twice. Newly accepted npm packages can remain invisible while registry processing finishes; the publishing job retries public visibility for up to 10 minutes without prompting for manual approval. After confirming that exact npm version is public, it dispatches the matching MCP Registry publication job. npm Trusted Publisher must authorize `.github/workflows/release.yml` and permit **direct publication**, not stage-only. This is a provider-side prerequisite, not a second GitHub workflow.

GitHub does not override npm account/package security settings. If the npm publisher is configured for stage-only access or another mandatory owner restriction, the direct publish job fails clearly instead of silently staging or bypassing security. Avoid publishing historical versions to work around an npm account restriction; repair the publisher configuration through authorized account settings.

## GHCR and MCP Registry

The release workflow triggers `.github/workflows/docker.yml` with the immutable `ssh-mcp-pro-vX.Y.Z` tag. GHCR must grant this repository's GitHub Actions **Write** access to the existing `ghcr.io/oaslananka/ssh-mcp-pro` package. Package access is managed through **GitHub Packages → Package settings → Manage Actions access**. Docker publishing verifies the release tag and package version before pushing both platform tags.

The MCP Registry job requires an existing GitHub Release and the *same publicly visible npm version*. It skips versions already registered and uses GitHub OIDC. There is no daily staged-publication reconciliation job. The automatic npm publish job dispatches MCP Registry publication only after npm confirms the matching version is public; manual recovery uses the same checks.

## Verify and troubleshoot

- `gh release view ssh-mcp-pro-vX.Y.Z --json assets` — the prepared GitHub Release.
- `gh run list --workflow release.yml` — release preparation, automatic npm publication and optional manual recovery status.
- `npm view ssh-mcp-pro@X.Y.Z version` — independently verify actual npm publication.
- `gh run list --workflow docker.yml` and `gh api users/oaslananka/packages/container/ssh-mcp-pro` — GHCR status.
- `gh run list --workflow publish-mcp-registry.yml` — MCP Registry publication.

Do not confuse a successful GitHub Release (or npm production environment deployment event) with a successful public npm/GHCR publication. Check the actual registry records before announcing an ecosystem release.
