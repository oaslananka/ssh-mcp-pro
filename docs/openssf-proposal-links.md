# OpenSSF Proposal Links

Reference links for acting on the findings in
[docs/repo-maturity-report.md](repo-maturity-report.md) and
[docs/openssf-gap-analysis.md](openssf-gap-analysis.md). These are pointers to where a
maintainer takes the next action, not automated submissions — no badge or scorecard
submission has been made on the project's behalf by this audit.

## OpenSSF Best Practices badge

- Self-assessment form (submit once the CodeQL/first-release gaps in
  `docs/openssf-gap-analysis.md` close): <https://www.bestpractices.dev/en/projects/new>
- Full criteria reference used for this audit: <https://www.bestpractices.dev/en/criteria/0>
- `.bestpractices.json` in the repo root tracks current self-assessment answers to make
  filling out the form above mechanical.

## OpenSSF Scorecard

- Public checks reference: <https://github.com/ossf/scorecard/blob/main/docs/checks.md>
- Scorecard viewer for this repo (once `publish_results` is re-enabled or a manual run
  is published): <https://securityscorecards.dev/viewer/?uri=github.com/oaslananka/ssh-mcp-pro>
- `ossf/scorecard-action` documentation for the `publish_results` requirements that are
  currently blocking automatic publication: <https://github.com/ossf/scorecard-action#authenticated-workflow>

## GitHub repository configuration referenced by this audit

- Branch protection settings: `https://github.com/oaslananka/ssh-mcp-pro/settings/branches`
- Rulesets (to import `.github/rulesets/main-protection.json`):
  `https://github.com/oaslananka/ssh-mcp-pro/settings/rules`
- Security & analysis settings (private vulnerability reporting, Dependabot security
  updates): `https://github.com/oaslananka/ssh-mcp-pro/settings/security_analysis`
- Code scanning alerts: `https://github.com/oaslananka/ssh-mcp-pro/security/code-scanning`

## CHAOSS

- Metrics reference used for the Community maturity section:
  <https://chaoss.community/metrics/>
