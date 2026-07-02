# Release Integrity

How a release artifact can be verified, and what mechanism backs each guarantee. See
[docs/development/release-process.md](../development/release-process.md) for the full
release flow this is extracted from.

| Guarantee | Mechanism | Verify with |
| --- | --- | --- |
| The tarball wasn't corrupted/tampered in transit | SHA-256 checksum generated in `release-assets` (`sha256sum "artifacts/${PACKAGE_FILE}" > ...sha256`) | `sha256sum -c ssh-mcp-pro-<version>.tgz.sha256` |
| The tarball was actually built by this repo's release workflow, from the commit it claims | `actions/attest-build-provenance` on the package | `gh attestation verify ssh-mcp-pro-<version>.tgz --owner oaslananka` |
| The SBOM matches the released package and wasn't tampered with | Separate checksum + separate `actions/attest-build-provenance` run with `sbom-path` set | `sha256sum -c sbom.cdx.json.sha256`, `gh attestation verify sbom.cdx.json --owner oaslananka` |
| What's actually inside the package (dependency inventory) | CycloneDX SBOM (`pnpm run sbom`) | Inspect `sbom.cdx.json` directly, or feed it to any CycloneDX-compatible scanner |
| npm package provenance (when published) | `npm publish --provenance` (conditional on `AUTO_RELEASE_PUBLISH` repo variable) | `npm view ssh-mcp-pro provenance`, or the "Provenance" panel on the npmjs.com package page |
| Container image integrity | Digest-pinned references, no mutable `latest` tag | See [docs/docker.md](../docker.md) |

## Current limitation

None of the above has been exercised against a real release yet — no release has been
published (see [docs/repo-maturity-report.md](../repo-maturity-report.md)). The
mechanisms are implemented and reviewed here on paper; they should be spot-checked
against the first actual release before being relied on operationally.

## What this does *not* claim

This project does not claim a specific SLSA build level. `actions/attest-build-provenance`
produces build provenance attestations (in-toto/SLSA-compatible statements), which is a
meaningfully strong signal, but claiming a specific SLSA level requires meeting that
level's full requirement set — not attempted here to avoid overclaiming.
