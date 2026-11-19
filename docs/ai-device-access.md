# Manage which AI connections can access your devices

Each OAuth authorization creates its own AI connection. An owner can decide which
enrolled devices that connection can see and use through the SSH MCP Pro cloud
control plane, without disabling the device for other AI connections.

## Configure device access

1. Sign in to the web workspace and open **AI clients**.
2. Under the authorized connection, select the enrolled devices it may access.
   Online and offline devices can both be selected. A newly added device is not
   shared with any existing AI connection automatically.
3. Select **Save device access**. Once saved, new tool requests use these
   permissions immediately. The **Devices** page displays an inverse summary
   of which AI connections have explicit access.
4. To stop only one AI connection, select **Disconnect this AI**. The device
   remains enrolled and usable by other authorized connections.
   **Revoke device** and **Remove device** under **Devices** are global actions,
   and should not be used merely to disconnect one AI.

New authorizations start with no shared devices. An AI connected without a
selected device receives an empty device list. A missing or denied device
cannot be accessed by guessing its ID or alias.

## Existing integrations and migration

For backwards compatibility, existing OAuth access tokens and refresh grants
without connection identity continue working until the owner first enables
device access controls. The first **Save device access** requires an explicit
confirmation; this activates strict visibility for that account. Previously
issued unbound access tokens are then rejected, and legacy unbound refresh
tokens/authorization codes are invalidated. These old AI connections must
be reauthorized and have their devices selected in the workspace.

This activation applies to all AI connections under that account. It does
not unenroll or restart devices. Reconnection is required only for older
OAuth clients whose existing credentials lack a connection identity.

Disconnecting one identified connection rejects its new requests immediately,
including requests using previously issued access tokens. Already running
device operations cannot be retroactively undone.

## What these controls do not change

- Device selection controls **visibility and selection**, not shell, sudo,
  file-write or other operational privileges. OAuth scopes and agent-local
  policy must also allow each action.
- These cloud controls do not govern independent local stdio MCP sessions.
- Multiple subagents using the same OAuth credential are one connection from
  the server's perspective. They need distinct OAuth authorizations to receive
  different device selections.
- Client display names and redirect hosts are descriptive, not verified proof
  that a named AI vendor operates the connection.

Device sharing changes, disconnections and denied access are recorded in
the account-scoped activity audit without storing raw credentials or output.
