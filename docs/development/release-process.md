# Release Process

## Versioning

Semantic Versioning, automated by [release-please](https://github.com/googleapis/release-please)
per [release-please-config.json](../../release-please-config.json) (`node` release
type). Conventional Commit types on `main` (see
[commit-conventions.md](commit-conventions.md)) drive whether the next release is a
patch, minor, or major bump.

## How a release happens

1. Conventional commits land on `main`.
2. The `release` job in [.github/workflows/release.yml](../../.github/workflows/release.yml)
   runs `googleapis/release-please-action`, which opens or updates a release PR
   (updating `CHANGELOG.md`, `.release-please-manifest.json`, and the version fields
   release-please is configured to touch — see `extra-files` in
   `release-please-config.json`, which includes `mcp.json`, `server.json`, and the MCP
   registry record).
3. Merging that PR triggers `release_created`, which runs the `release-assets` job:
   - `pnpm run check` (full quality gate) must pass.
   - `pnpm run sbom` generates a CycloneDX SBOM.
   - The package is packed with `pnpm pack`, and both the tarball and the SBOM get a
     `sha256sum` checksum file.
   - `actions/attest-build-provenance` runs twice — once for the package, once for the
     SBOM — producing verifiable build provenance attestations.
   - All artifacts (tarball, SBOM, checksums) are attached to the GitHub Release.
   - npm publish only happens if the repository variable `AUTO_RELEASE_PUBLISH` is
     `"true"`; otherwise the step is a documented no-op ("npm publishing is disabled by
     AUTO_RELEASE_PUBLISH").

## Verifying a release artifact

```bash
sha256sum -c ssh-mcp-pro-<version>.tgz.sha256
```

For provenance, use [GitHub CLI attestation verification](https://cli.github.com/manual/gh_attestation_verify):

```bash
gh attestation verify ssh-mcp-pro-<version>.tgz --owner oaslananka
```

See [docs/security/release-integrity.md](../security/release-integrity.md) for the full
supply-chain rationale.

## Current status

No release has been published yet (repository created 2026-06-28). Release PR #1
(`chore(main): release ssh-mcp-pro 1.2.0`) is open and is the first opportunity to
exercise this pipeline end-to-end — see [ROADMAP.md](../../ROADMAP.md).

## Container images

Published separately by [.github/workflows/docker.yml](../../.github/workflows/docker.yml)
on tagged releases; see [docs/docker.md](../docker.md) for tag policy and digest-pinned
usage.
