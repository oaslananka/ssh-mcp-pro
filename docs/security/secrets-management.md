# Secrets Management

Covers both how ssh-mcp-pro handles secrets at runtime, and how this repository's own
CI/CD handles secrets. No secrets, tokens, or credentials were added to the repository
by this audit — this document only records what already exists.

## Runtime (the deployed server)

- **Bearer tokens are read from a file** (`SSH_MCP_HTTP_BEARER_TOKEN_FILE`), not passed
  directly as an environment variable value, reducing exposure via process listings and
  environment dumps.
- **Bearer token comparison uses `timingSafeEqual`** (documented in
  `SECURITY_DECISIONS.md`), avoiding timing side-channels.
- **Connector credential providers** (`SSH_MCP_CONNECTOR_CREDENTIAL_PROVIDER=command`)
  resolve credentials via an external command rather than storing them in configuration,
  and reject command output containing forbidden secret-shaped fields (see
  `test/unit/connector-credentials.test.ts`).
- **Audit logging redacts sensitive fields** per `SECURITY_DECISIONS.md`, within a
  bounded 500-event buffer.
- **Known open gap:** CodeQL alert #1 (High) flags clear-text logging of sensitive
  environment data in `scripts/start-chatgpt-http.mjs` — this is exactly a secrets
  handling defect, tracked as a recommended issue in
  [docs/repo-maturity-report.md](../repo-maturity-report.md), not fixed by this audit.

## CI/CD

- **No long-lived npm token.** The release workflow explicitly `unset`s
  `NODE_AUTH_TOKEN`/`NPM_CONFIG_USERCONFIG` before publishing and relies on
  `id-token: write` + `npm publish --provenance` — npm's OIDC trusted-publishing flow,
  not a stored secret. See [docs/security/release-integrity.md](release-integrity.md).
- **No Docker registry password stored** — GHCR login uses `${{ github.token }}`
  (the automatically-provisioned, workflow-scoped token), not a personal access token.
- **This audit's own `gitleaks.yml` addition uses `${{ secrets.GITHUB_TOKEN }}`** —
  the same automatic token, required by `gitleaks-action` v3 to scan pull requests. No
  new secret was created or requested.
- **GitHub secret scanning + push protection are enabled** at the repository level
  (confirmed via API), catching accidental secret commits before they're even pushed.
- **`.env.example` exists** and should be the only `.env*`-shaped file ever committed;
  `.gitignore` is expected to exclude real `.env` files (verify locally if adding new
  env-derived tooling).

## If you're adding a new CI step that needs credentials

Before adding any token: check whether OIDC/trusted-publishing is available for the
target platform first (npm and PyPI both support it; GHCR uses the automatic
`GITHUB_TOKEN`). Long-lived tokens should be a last resort, not a default — see the
constraints this audit operated under in
[docs/repo-maturity-report.md](../repo-maturity-report.md).
