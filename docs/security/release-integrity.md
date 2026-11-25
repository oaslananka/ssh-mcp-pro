# Release Integrity

Use the published GitHub Release, immutable tag and signed attestations to
verify a distribution before installation. See [Release Process](../development/release-process.md)
for the publication workflow.

| Guarantee | Mechanism | Verification |
| --- | --- | --- |
| Download integrity | SHA-256 checksums generated during release preflight | Check the package and SBOM checksums |
| Package build provenance | `actions/attest-build-provenance` on the package tarball | Verify the tarball's SLSA provenance against the repository, workflow and source commit |
| Signed dependency inventory | `actions/attest` with the CycloneDX SBOM as predicate and the **tarball** as subject | Verify the CycloneDX attestation on the tarball and compare its signed predicate with the downloaded SBOM |
| npm distribution | Direct npm publication using GitHub-hosted OIDC after artifact verification | Compare the public npm tarball to the verified GitHub tarball; inspect the npm package provenance panel |
| Container image integrity | Release-specific GHCR tags and digest-pinned references | See [Docker](../docker.md) |

## Verify a published release

The following Bash example uses Git, GitHub CLI (`gh`), curl, sha256sum and jq.
Run it in a fresh directory. Set the version to the intended release and
verify the tag's commit against the intended source before trusting it.

~~~bash
set -euo pipefail
REPO=oaslananka/ssh-mcp-pro
VERSION=1.18.0
TAG="ssh-mcp-pro-v${VERSION}"
PACKAGE="ssh-mcp-pro-${VERSION}.tgz"
SOURCE="$(git ls-remote "https://github.com/${REPO}.git" "refs/tags/${TAG}" | cut -f1)"
test -n "$SOURCE"
gh release download "$TAG" --repo "$REPO" \
  --pattern "$PACKAGE" --pattern "$PACKAGE.sha256" \
  --pattern sbom.cdx.json --pattern sbom.cdx.json.sha256
sha256sum -c "$PACKAGE.sha256"
sha256sum -c sbom.cdx.json.sha256
gh attestation verify "$PACKAGE" --repo "$REPO" \
  --signer-workflow "$REPO/.github/workflows/release.yml" \
  --source-digest "$SOURCE"
gh attestation verify "$PACKAGE" --repo "$REPO" \
  --signer-workflow "$REPO/.github/workflows/release.yml" \
  --source-digest "$SOURCE" --predicate-type https://cyclonedx.org/bom \
  --format json > verified-sbom.json
jq -e '.[0].verificationResult.statement.predicate | objects' \
  verified-sbom.json | jq -S . > signed-sbom.json
jq -S . sbom.cdx.json > downloaded-sbom.json
diff -u signed-sbom.json downloaded-sbom.json
curl --fail --silent --show-error --location \
  "https://registry.npmjs.org/ssh-mcp-pro/-/$PACKAGE" -o npm-package.tgz
cmp "$PACKAGE" npm-package.tgz
~~~

The SBOM attestation signs the inventory **for the package**, not a standalone
SBOM-file provenance statement. Verifying the SBOM file as the subject would
look up a different digest. A checksum alone does not establish origin.

## Observed release verification

On 2026-11-25, [v1.18.0](https://github.com/oaslananka/ssh-mcp-pro/releases/tag/ssh-mcp-pro-v1.18.0)
was independently checked against source commit
`009939459e9da5d6639190593b712e477277f1b5`. Both signed predicates verified,
the signed SBOM matched the downloaded JSON, and the npm and GitHub tarballs
had identical SHA-256 values. GHCR and MCP Registry also listed the release.
See the [release workflow run](https://github.com/oaslananka/ssh-mcp-pro/actions/runs/45616735770).
Repeat verification for each new release rather than relying on this example.

## What this does not claim

These checks do not establish a specific SLSA build level, absence of
vulnerabilities, or successful hosted deployment. Hosted deployment also
requires the independent recovery acceptance described in [Coolify deployment](../coolify.md).
The [repository maturity report](../repo-maturity-report.md) is a historical
audit snapshot, not the current release inventory.
