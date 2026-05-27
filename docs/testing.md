# Testing

## Mutation testing

Mutation testing is configured for policy-critical security surfaces only. The
line-range allowlist lives in `stryker.conf.mjs` and covers the allow/deny
branches in `src/policy.ts`, `src/safety.ts`, `src/config.ts`,
`src/session.ts`, `src/http-security.ts`, and the auth and remote control-plane
policy modules. Whole-file mutation targets are intentionally avoided so the
scheduled gate stays bounded. Stryker uses `vitest.mutation.config.ts` so the
advisory gate runs only unit-level security regression tests and does not
require integration, E2E, or performance fixtures. Static file-load mutants are
ignored with Stryker's `ignoreStatic` setting to keep the scheduled gate runtime
predictable while the mutation score is advisory.

The CI mutation job is advisory while the score is calibrated. It runs on
`schedule` and `workflow_dispatch`, uses `continue-on-error: true`, and uploads
`reports/mutation` for review.

Promotion criteria:

- Keep the mutation allowlist focused on policy-critical modules until runtime
  is stable.
- Reach and hold the 80% high-score target for at least three scheduled runs.
- Investigate surviving mutants in root login denial, strict host-key mode,
  destructive command denial, raw sudo denial, tunnel bind-host denial, and path
  policy denial before raising the gate.
- Promote by removing `continue-on-error`, setting a non-null
  `thresholds.break`, and adding the job to required branch protection only
  after the score is stable.

Local validation on Linux/macOS:

```bash
pnpm run test:coverage
pnpm run test:integration
pnpm run test:e2e
pnpm run test:perf
pnpm run test:mutation
```

Windows 11 PowerShell validation:

```powershell
pnpm run test:coverage
pnpm run test:integration:windows
pnpm run test:e2e
pnpm run test:perf
pnpm run test:mutation
```
