# Support and Triage Policy

GitHub Issues is the single source of truth for support, triage, audit findings,
release blockers, and follow-up work for `ssh-mcp-pro`.

## Support Path

Use GitHub Issues for reproducible bugs, scoped feature requests, release tasks,
documentation gaps, and operational questions that need maintainer follow-up.

GitHub Discussions is intentionally not enabled for this repository. A second
public queue would split triage state away from the issue labels, milestones,
and the `ssh-mcp-pro Governance` project used for release and audit tracking.

Security reports must use GitHub Security Advisories instead of public issues
when they involve any of these areas:

- credential, token, cookie, or private key exposure
- authentication or authorization bypass
- policy bypass for denied SSH, sudo, filesystem, tunnel, or process actions
- host-key verification downgrade or bypass
- unintended command execution or destructive remote mutation
- sensitive SSH session, host, or filesystem data exposure

Private advisory link:
<https://github.com/oaslananka/ssh-mcp-pro/security/advisories/new>

## Response Targets

Maintainers aim to label and route non-security issues within 7 calendar days.
Security advisories follow the response and disclosure expectations documented
in `SECURITY.md`.

Priorities are assigned with these labels:

| Label | Meaning |
| --- | --- |
| `priority:P0` | Security, active CVE, broken default branch CI, broken publish or install path, data loss risk, or release-blocking defect. |
| `priority:P1` | High-impact broken feature, major version upgrade, governance gap, or compliance gap. |
| `priority:P2` | Scheduled quality, testing, developer experience, technical debt, or outdated dependency work. |
| `priority:P3` | Documentation polish, community polish, or future capability adoption. |

## Canonical Labels

Every open issue should carry exactly one label from each canonical group:

| Group | Required labels |
| --- | --- |
| Priority | `priority:P0`, `priority:P1`, `priority:P2`, `priority:P3` |
| Area | `area:release`, `area:ci`, `area:security`, `area:docs`, `area:compatibility`, `area:testing`, `area:packaging`, `area:dx`, `area:infra`, `area:governance` |
| Type | `type:bug`, `type:enhancement`, `type:task`, `type:docs`, `type:security` |
| Risk | `risk:high`, `risk:medium`, `risk:low` |

Legacy labels such as `bug`, `enhancement`, `documentation`, `release`, and
`dependency-lifecycle` may remain for GitHub defaults, discoverability, and
historical context, but they do not replace canonical taxonomy labels.

## Stale and Duplicate Issues

When an issue needs more reporter input, maintainers may request information and
leave the issue open. If there is no response for 30 calendar days after that
request, maintainers may mark it stale or blocked. If there is still no response
after another 14 calendar days, maintainers may close it with a comment linking
the missing information request. Closed issues can be reopened when new evidence
is available.

Duplicate or migrated issues should be normalized to the canonical label format,
linked to the canonical issue, and closed when the canonical issue already tracks
the same work.

## Project Tracking

The `ssh-mcp-pro Governance` GitHub Project v2 is the governance board for
audit-created and maintainer-owned issues. It uses project number `5` under the
`oaslananka` owner and must keep these fields available for issue work:

- Product
- Area
- Priority
- Phase
- Status
- Risk

Maintainers can verify repository taxonomy and project coverage with:

```bash
pnpm run check:governance
```

The GitHub CLI token must include project access for project validation. If the
command reports a missing project scope, refresh authentication with:

```bash
gh auth refresh -s read:project
```
