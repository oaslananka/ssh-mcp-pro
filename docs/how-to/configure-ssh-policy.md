# How to configure the SSH policy

This guide walks through the most common policy adjustments. Every setting here is one
row in the [environment variable reference](../../README.md#configuration) — this guide
just groups them by task.

## Loosen host-key checking for a lab environment

By default `SSH_MCP_HOST_KEY_POLICY=strict`, which requires every host to already be in
`SSH_MCP_KNOWN_HOSTS_PATH`. For a throwaway lab environment where you accept the risk:

```bash
export SSH_MCP_HOST_KEY_POLICY=accept-new
```

Do not set this to `insecure` outside of a fully isolated test environment — see
[SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md) for why `strict` is the default.

## Allow a specific destructive operation

Destructive commands and filesystem operations (like `fs_rmrf`) are denied by default.
To allow them for a specific deployment:

```bash
export SSH_MCP_ALLOW_DESTRUCTIVE_COMMANDS=true
export SSH_MCP_ALLOW_DESTRUCTIVE_FS=true
```

Prefer narrowing scope with `SSH_MCP_COMMAND_ALLOW`/`SSH_MCP_COMMAND_DENY` and
`SSH_MCP_PATH_ALLOW_PREFIXES`/`SSH_MCP_PATH_DENY_PREFIXES` instead of a blanket allow,
where possible.

## Restrict which hosts can be targeted at all

```bash
export SSH_MCP_ALLOWED_HOSTS="bastion.example.com,10.0.0.0/8"
```

## Use a policy file instead of many environment variables

```bash
export SSH_MCP_POLICY_FILE=/etc/ssh-mcp-pro/policy.json
export SSH_MCP_POLICY_MODE=enforce
```

Set `SSH_MCP_POLICY_MODE=explain` first in a non-production environment to see what the
policy *would* block without actually enforcing it, before flipping to `enforce`.

See [docs/security/input-validation.md](../security/input-validation.md) for how these
allow/deny lists are evaluated.
