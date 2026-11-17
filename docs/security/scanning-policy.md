# Security scanning policy

This repository uses complementary scanners because no single tool covers source code,
dependencies, secrets, workflow configuration, and container images equally well.

## Required controls

| Surface | Primary control | Enforcement |
| --- | --- | --- |
| TypeScript and workflows | CodeQL, Semgrep, and SonarQube Cloud | Required pull-request checks where configured |
| Dependency graph | `pnpm audit`, dependency review, Socket, and OSV verification | Moderate-or-higher audit findings fail the canonical quality gate unless a reviewed, expiring exception exists |
| Secrets | Gitleaks, SonarQube secrets, and Trivy filesystem scanning | New verified findings block merge |
| Container image | Trivy | Fixable High and Critical vulnerabilities fail the Docker workflow |
| Release artifacts | SBOM, package smoke tests, provenance, and registry metadata checks | Required before publishing |

## Time-bounded development-tool advisory exception

- **Advisory:** [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) / CVE-2026-112366 (High), affecting picomatch through 4.0.7.
- **Owner:** Osman Aslan. **Expires:** 2026-12-17 00:00 UTC; the quality gate fails closed after this date.
- **Evidence (2026-11-17):** No patched picomatch release exists in the official registry. Both installed vulnerable versions (4.0.4 and 4.0.7) are reached only through development tooling (dependency-cruiser, vitest/Vite, knip and Stryker). The independent production dependency audit reports zero findings; the packed consumer is separately audited.
- **Enforcement:** The dedicated audit checker runs the production audit without exceptions, then reads the complete pnpm audit JSON. It accepts only this single advisory **while every reported path is provably development-only and no patched version exists**. Other moderate-or-higher advisories, registry errors, exposure reaching production, or expiry block the build. No persistent pnpm ignore configuration is applied.
- **Removal:** As soon as a patched upstream release is available, upgrade and remove this exception. Reassess before expiry; do not extend silently. This is a documented temporary risk, **not a claim that the vulnerability has been fixed**.

## Container policy

The Docker workflow performs two scans against the image built from the pull-request or
release commit:

1. A SARIF scan reports all High and Critical findings to GitHub code scanning.
2. A separate enforcement scan fails on **fixable** High or Critical vulnerabilities.

`ignore-unfixed: true` is intentionally limited to the enforcement scan. Unfixed findings
remain visible in SARIF and must be reconsidered when a fix becomes available. The project
does not maintain wildcard ignores or an indefinite `.trivyignore` baseline. A temporary
exception must identify the advisory, explain the exposure, name an owner, and include an
expiry date in a reviewed repository file or issue.

Short-lived test-runner images, such as `Dockerfile.test`, are not required to define a
`HEALTHCHECK`; they do not run a service and exit when the test command completes.

## Local verification

```bash
osv-scanner scan source --recursive .
semgrep ci --dry-run
trivy fs --skip-dirs node_modules --scanners vuln,misconfig,secret .
```

Container enforcement requires Docker access:

```bash
docker build -t ssh-mcp-pro:local .
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 ssh-mcp-pro:local
```

Scanner output is evidence, not an automatic code-change mandate. Protocol-required
cryptography, bounded configuration regexes, and short-lived build images must be reviewed
in context rather than changed solely to silence a generic rule.
