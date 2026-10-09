# Release Process

## Version and metadata preparation

Release Please v5 (SHA pinned in `.github/workflows/release.yml`) prepares Conventional Commit-driven, SemVer release PRs. `release-please-config.json` updates `CHANGELOG.md`, package/manifest versions, `mcp.json`, both `server.json` npm transports, registry metadata, ChatGPT and Claude readiness metadata, and `src/mcp.ts` (`x-release-please-version`). A release PR must pass repository protection and current-head CI before merging. Run `node scripts/validate-release-please.mjs` and `node scripts/sync-version.mjs --check` to inspect current state.

## Fail-closed release pipeline

A push to `main` checks whether the package version already has a GitHub Release. When the version is not yet released (normally a merged Release Please PR), `release-preflight` executes **before** Release Please creates the tag and public GitHub Release:

1. Install frozen dependencies using pinned Node and pnpm.
2. Enforce dependency freshness (`check:freshness`) and full quality (`pnpm run check`). Any failure stops release creation. Investigate the reported dependency failures rather than weakening these gates.
3. Build package tarball and CycloneDX SBOM, hash both, attest package and SBOM provenance, and persist the verified outputs as an immutable workflow artifact.
4. Only if preflight succeeds does Release Please run. It may create/update a release PR on ordinary nonrelease commits without performing expensive prerelease checks.
5. When `release_created` is true, `release-assets` downloads the same preflight-built artifacts, verifies source tag and SHA-256 checksums, attaches the package, SBOM and checksums to GitHub Release, and verifies the uploaded asset names.

This minimizes the window for an incomplete GitHub Release. GitHub API upload failures may still require a separately gated artifact-recovery execution; a completed tag/release is **not** evidence of successful npm, GHCR or MCP Registry distribution.

## npm publishing and provenance

`npm-production` is the OIDC environment for releases. The normal npm direct publish is deliberately **disabled** unless `AUTO_RELEASE_PUBLISH` is exactly `true` in repository/environment variables and the npm Trusted Publisher explicitly allows `npm publish`. When enabled, the verified preflight tarball is published with provenance and the exact npm version is checked before downstream MCP Registry dispatch. The current policy keeps that variable absent; no default automatic npm mutation should be inferred from a GitHub Release.

npm **staged publishing** requires separate maintainer 2FA approval to make a version public. `ssh-mcp-pro@1.2.1` was already staged through the original OIDC workflow as stage `a083f086-af6e-459b-8e4c-75e9719e6653`. Do **not** restage this version, directly publish it, or revoke existing provider credentials solely because the source workflow is green. An owner must inspect and approve its staged package on npmjs.com; verify that the public registry now resolves version `1.2.1` afterward.

## Container image and MCP Registry

GitHub's default `GITHUB_TOKEN` does not generate downstream Actions runs from release/tag events. Therefore `release-assets` explicitly dispatches `.github/workflows/docker.yml` **after** successful asset verification with the immutable tag `ssh-mcp-pro-vX.Y.Z`. The Docker workflow checks the tag, matching package version and presence of a GitHub Release tarball before pushing two architecture-tagged images to GHCR; then verifies the published digest.

An npm direct publish, if enabled, explicitly dispatches `.github/workflows/publish-mcp-registry.yml` after npm version verification. The registry workflow checks out the immutable tag, requires an existing GitHub Release asset, verifies the exact public npm version, skips an already registered version and uses GitHub OIDC for publication.

A daily registry reconciliation job checks released versions against **public npm** and the official MCP Registry. After a staged version becomes publicly available through owner 2FA approval, reconciliation dispatches an eligible missing version. If npm is still staged or the registry returns an unexpected error, the job does **not** publish. This means registry distribution can lag approval until the next scheduled run (or an authorized manual dispatch).

## Recovery for the incomplete v1.2.1 GitHub Release

GitHub Release `ssh-mcp-pro-v1.2.1` was created on 2026-10-06, but the original release asset job failed after a dependency freshness check; the published GitHub Release had zero assets. After the recovery changes are merged, use **Actions → Release → Run workflow** once on `main` to perform the **asset-only** recovery. This dispatch checks out the fixed `ssh-mcp-pro-v1.2.1` tag, checks its known source SHA and metadata, runs package validation, rebuilds and attests the tarball/SBOM, attaches and verifies the assets. It does **not** publish the historical v1.2.1 GHCR image: that immutable tag predates the Alpine zlib security patch. GHCR publication resumes automatically for the first newly validated release containing the patch.

Crucially, manual Release workflow dispatch now **never** runs `npm stage publish`, `npm publish`, or Release Please. The already-staged npm 1.2.1 remains untouched and requires its original owner approval. Do not interpret successful asset recovery as npm publication.

## Verification and troubleshooting

Inspect each stage independently: `gh release view ssh-mcp-pro-vX.Y.Z --json assets`, `gh run list --workflow Release`, `gh run list --workflow Docker`, `gh run list --workflow publish-mcp-registry.yml`, `npm view ssh-mcp-pro@X.Y.Z version`, and the registry's `/v0.1/servers/io.github.oaslananka%2Fssh-mcp-pro/versions/X.Y.Z` endpoint. GHCR should expose both exact immutable tags and a digest. Do not advertise an unfinished release as fully distributed.
