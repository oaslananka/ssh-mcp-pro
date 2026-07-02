# Governance

This document describes how decisions are made in ssh-mcp-pro today. It is
written to be accurate, not aspirational — see [ROADMAP.md](ROADMAP.md) for
how this is expected to evolve.

## Current model: single maintainer

ssh-mcp-pro is currently maintained by one person,
[@oaslananka](https://github.com/oaslananka) (see [MAINTAINERS.md](MAINTAINERS.md)
and [.github/CODEOWNERS](.github/CODEOWNERS)). The maintainer has final say over
all technical direction, release timing, and acceptance of contributions.
There is no steering committee, voting process, or formal RFC process, because
there is no second decision-maker for one to coordinate with yet.

This is stated explicitly, rather than implied, because governance documents
that describe a committee or consensus process that doesn't exist are
misleading to prospective contributors and reviewers (including automated
OpenSSF/CHAOSS-style audits).

## Decision-making

- **Day-to-day changes** (bug fixes, docs, dependency updates, CI tweaks): made
  directly by the maintainer, or via pull request from a contributor that the
  maintainer reviews and merges.
- **Security-relevant changes** (anything touching `src/safety.ts`,
  `src/session.ts`, `src/policy.ts`, host-key handling, or default-deny
  behavior described in [SECURITY_DECISIONS.md](SECURITY_DECISIONS.md)):
  require explicit maintainer sign-off; automated merges are not used for
  these paths.
- **Breaking changes**: follow [MIGRATION.md](MIGRATION.md) and Conventional
  Commits `!`/`BREAKING CHANGE:` conventions (see
  [docs/development/commit-conventions.md](docs/development/commit-conventions.md)),
  and are called out in `CHANGELOG.md` via release-please.
- **Governance/process changes** (this document, `MAINTAINERS.md`,
  `CODEOWNERS`): maintainer decision, informed by contributor feedback in
  issues.

## Contributing to decisions

Anyone can propose a change via a GitHub issue or pull request. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the process and quality gates a
contribution is expected to pass. There is currently no requirement for a
second reviewer's approval before merge, because there is no second
maintainer — see the branch protection gap noted in
[docs/repo-maturity-report.md](docs/repo-maturity-report.md).

## Path to adding maintainers

The project will consider adding a second maintainer once there is a track
record of sustained, high-quality external contributions. A prospective
maintainer would be expected to have:

- Multiple merged, non-trivial pull requests.
- Demonstrated familiarity with the security defaults in
  [SECURITY_DECISIONS.md](SECURITY_DECISIONS.md) — this project executes
  remote commands over SSH by design, and maintainers need to understand the
  guardrails, not just the feature code.
- Willingness to take on issue triage and PR review, not just code
  contribution.

There is no fixed timeline for this; it is driven by contribution history, not
a calendar date.

## Escalation

For conduct concerns, see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For
security reports, see [SECURITY.md](SECURITY.md). For everything else, see
[SUPPORT.md](SUPPORT.md).
