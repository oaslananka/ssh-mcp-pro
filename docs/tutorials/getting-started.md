# Tutorial: Getting Started

This is a learning-oriented walkthrough: follow it top to bottom and you'll end with a
working local ssh-mcp-pro connected to an MCP client and one successful remote command.
Per [Diátaxis](https://diataxis.fr/tutorials/), it favors one guaranteed-to-work path
over covering every option — see [How-to guides](../how-to/README.md) for other tasks
and [Reference](../reference/README.md) for the full option set.

## 1. Prerequisites

You need:

- Node.js `>=22.22.2` (or `>=24.15.0` / `>=26.3.0`) and pnpm `>=11.0.9`.
- At least one host you can already reach with plain `ssh`, with its key already in
  your `~/.ssh/known_hosts` (this tutorial uses the default `strict` host-key policy —
  see [SECURITY_DECISIONS.md](../../SECURITY_DECISIONS.md) for why).

## 2. Install

```bash
pnpm add --global ssh-mcp-pro
ssh-mcp-pro --version
```

If that prints a version number, installation worked.

## 3. Register it with an MCP client

Pick the block matching your client and add it to that client's MCP config (see
[INSTALL.md](../../INSTALL.md) for exact file locations per client):

```json
{
  "mcpServers": {
    "ssh-mcp-pro": {
      "command": "ssh-mcp-pro",
      "args": []
    }
  }
}
```

Restart or reload your MCP client so it picks up the new server.

## 4. Confirm the server is visible

In your MCP client, ask it to list available tools, or run:

```text
List configured SSH hosts.
```

You should see a response describing zero or more configured hosts — an empty list is
expected if you haven't pointed `ssh-mcp-pro` at any host config yet; it means the
server started and responded, which is the thing this step is actually checking.

## 5. Inspect the active policy

Before running anything against a real host, see what's allowed:

```text
Explain the active SSH policy.
```

This reflects the deny-by-default settings described in the
[Security Defaults](../../README.md#security-defaults) section of the README: strict
host-key checking, no root login, no raw `sudo`, no destructive operations.

## 6. Connect to a host and run a safe, read-only command

```text
Connect to <your-host> as <your-user> with hostKeyPolicy=strict, then run os_detect.
```

If this succeeds, you have a working end-to-end setup: MCP client → ssh-mcp-pro →
your host.

## Next steps

- [How to configure the SSH policy](../how-to/configure-ssh-policy.md) if you need to
  change any default.
- [examples/README.md](../../examples/README.md) for more workflow examples.
- [docs/explanation/architecture.md](../explanation/architecture.md) to understand why
  the server is structured the way it is.
