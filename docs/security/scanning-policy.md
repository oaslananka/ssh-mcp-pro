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
