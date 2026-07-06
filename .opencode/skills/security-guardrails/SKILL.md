---
name: security-guardrails
description: Security-first workflow for ssh-mcp-pro tasks involving remote execution, sensitive files, credentials, service impact, and production safety.
---

# Security Guardrails Skill

Use this skill whenever an SSH task could affect confidentiality, integrity, availability, credentials, or production state.

## Rules

- Confirm the target host and environment.
- Separate diagnostics from mutation.
- Redact secrets and private data.
- Avoid broad scripts when a narrow command is enough.
- Require explicit approval for privileged, destructive, or service-affecting work.
- Include rollback or recovery notes for every approved change.

## Response requirements

Return risk level, approval requirement, evidence, exact plan, rollback path, and unresolved risk.
