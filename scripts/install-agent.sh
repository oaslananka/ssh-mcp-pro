#!/usr/bin/env bash
#
# install-agent.sh — Bootstrap a ssh-mcp-pro outbound agent on a Linux or WSL host.
#
# It installs the published package, enrolls this machine with a one-time
# enrollment token, and registers a systemd service so the agent reconnects
# automatically on boot. Run it once per new device.
#
# Usage:
#   ./install-agent.sh --server <https://control-plane> --token <one-time-token> [options]
#
# Options:
#   --server  <url>     Control plane base URL (required)
#   --token   <token>   One-time enrollment token (required)
#   --alias   <name>    Agent alias shown in the fleet (default: hostname)
#   --version <semver>  Package version to install (default: latest)
#   --system            Install a system-wide service (needs root) instead of a user service
#   -h, --help          Show this help and exit
#
# The agent capabilities are fixed by the profile chosen when the enrollment
# token is created on the control plane (read-only / operations / full-admin),
# not by this script.

set -euo pipefail

SERVER=""
TOKEN=""
ALIAS="$(hostname)"
VERSION="latest"
SYSTEM_SCOPE="system"
SCOPE="user"

die() {
  echo "install-agent: $1" >&2
  exit 1
}

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --alias)
      ALIAS="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --system)
      SCOPE="$SYSTEM_SCOPE"
      shift
      ;;
    -h | --help)
      usage 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$SERVER" ]] || die "--server is required"
[[ -n "$TOKEN" ]] || die "--token is required"
[[ -n "$ALIAS" ]] || die "--alias must not be empty"

# System installs must not execute a user-managed Node/npm as root.
# The service identity is resolved before installation and reused for enrollment.
if [[ "$SCOPE" == "$SYSTEM_SCOPE" ]]; then
  PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
  export PATH
  [[ "$(id -u)" -eq 0 ]] || die "--system requires root; re-run with sudo"
  RUN_USER="${SUDO_USER:-root}"
  [[ "$RUN_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*\$?$ ]] || die "invalid service user"
  RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  [[ -n "$RUN_HOME" && "$RUN_HOME" == /* ]] || die "could not resolve home for service user '$RUN_USER'"
  ROOT_HOME="$(getent passwd root | cut -d: -f6)"
  [[ -n "$ROOT_HOME" && "$ROOT_HOME" == /* ]] || die "could not resolve root home"

  # Keep root's package manager independent of a caller's user npm config.
  export HOME="$ROOT_HOME"
  unset NODE_OPTIONS NODE_PATH NPM_CONFIG_PREFIX npm_config_prefix NPM_CONFIG_USERCONFIG npm_config_userconfig
else
  [[ "$(id -u)" -ne 0 ]] || die "user service must not be installed as root; run without sudo or pass --system"
fi

NODE_BIN="$(command -v node)" || die "node is not installed (need Node 22.22+ or 24+)"
NPM_BIN="$(command -v npm)" || die "npm is not installed"

# Check both the visible directory and the resolved target (including parents).
# Root-owned paths with group/world-writable ancestors are not trusted.
trusted_system_path() {
  local original="$1" resolved current mode
  [[ "$original" == /usr/* || "$original" == /opt/* || "$original" == /bin/* ]] || return 1
  resolved="$(readlink -f -- "$original")" || return 1
  [[ "$resolved" == /usr/* || "$resolved" == /opt/* || "$resolved" == /bin/* ]] || return 1
  for current in "$(dirname "$original")" "$resolved"; do
    while :; do
      [[ -e "$current" && "$(stat -c %u -- "$current")" -eq 0 ]] || return 1
      mode="$(stat -c %a -- "$current")" || return 1
      (( (8#$mode & 8#22) == 0 )) || return 1
      [[ "$current" == "/" ]] && break
      current="$(dirname "$current")"
    done
  done
}

if [[ "$SCOPE" == "$SYSTEM_SCOPE" ]]; then
  trusted_system_path "$NODE_BIN" || die "--system needs root-owned system Node.js under /usr or /opt (not a user-local runtime); install system Node.js and retry"
  trusted_system_path "$NPM_BIN" || die "--system needs root-owned system npm under /usr or /opt (not a user-local npm); install system npm and retry"
  PATH="$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  export PATH
fi

# WebSocket is available from Node 22.22+ and Node 24+.
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[1]')"
if [[ "$NODE_MAJOR" -lt 22 ]] || { [[ "$NODE_MAJOR" -eq 22 ]] && [[ "$NODE_MINOR" -lt 22 ]]; }; then
  die "Node $("$NODE_BIN" -v) is too old; install system Node 22.22+ or 24+ for --system"
fi

NPM_GLOBAL_PREFIX="$("$NPM_BIN" prefix -g)" || die "could not resolve npm global prefix"
[[ "$NPM_GLOBAL_PREFIX" == /* ]] || die "npm global prefix must be an absolute path"
if [[ "$SCOPE" == "$SYSTEM_SCOPE" ]]; then
  trusted_system_path "$NPM_GLOBAL_PREFIX" || die "--system needs a root-owned system npm global prefix (not a user-owned prefix); review npm config and retry"
fi

echo "install-agent: installing ssh-mcp-pro@${VERSION} globally"
"$NPM_BIN" install -g "ssh-mcp-pro@${VERSION}"

# npm creates Linux global executable links in <global-prefix>/bin, which
# need not be present in the caller's interactive PATH.
AGENT_BIN="${NPM_GLOBAL_PREFIX}/bin/ssh-mcp-pro-agent"
[[ -f "$AGENT_BIN" && -x "$AGENT_BIN" ]] || die "ssh-mcp-pro-agent missing or not executable at $AGENT_BIN after install"
SERVICE_PATH="$(dirname "$NODE_BIN"):$(dirname "$AGENT_BIN"):/usr/local/bin:/usr/bin:/bin"
case "$SERVICE_PATH" in
  *\"* | *$'\n'* | *$'\r'*) die "runtime paths cannot contain quotes or newlines" ;;
  *) ;;
esac

echo "install-agent: enrolling as alias '${ALIAS}'"
if [[ "$SCOPE" == "$SYSTEM_SCOPE" && "$RUN_USER" != "root" ]]; then
  [[ -x /usr/sbin/runuser ]] || die "--system needs /usr/sbin/runuser to enroll as service user '$RUN_USER'"
  /usr/sbin/runuser -u "$RUN_USER" -- /usr/bin/env "PATH=$SERVICE_PATH" "HOME=$RUN_HOME" "$AGENT_BIN" enroll --server "$SERVER" --token "$TOKEN" --alias "$ALIAS"
else
  /usr/bin/env "PATH=$SERVICE_PATH" "HOME=$HOME" "$AGENT_BIN" enroll --server "$SERVER" --token "$TOKEN" --alias "$ALIAS"
fi

write_unit() {
  cat <<EOF
[Unit]
Description=ssh-mcp-pro outbound agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart="${NODE_BIN}" "${AGENT_BIN}" run
Environment="PATH=${SERVICE_PATH}"
Restart=always
RestartSec=5
EOF
}

if [[ "$SCOPE" == "$SYSTEM_SCOPE" ]]; then
  UNIT="/etc/systemd/system/ssh-mcp-pro-agent.service"
  {
    write_unit
    echo "User=${RUN_USER}"
    echo "Environment=HOME=${RUN_HOME}"
    echo ""
    echo "[Install]"
    echo "WantedBy=multi-user.target"
  } >"$UNIT"
  systemctl daemon-reload
  # `enable --now` does not restart an already active agent after re-enrollment.
  # `restart` starts an inactive service and reloads new credentials when active.
  systemctl enable ssh-mcp-pro-agent.service
  systemctl restart ssh-mcp-pro-agent.service
  echo "install-agent: system service started — check 'systemctl status ssh-mcp-pro-agent'"
else
  UNIT_DIR="${HOME}/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  {
    write_unit
    echo "WorkingDirectory=%h"
    echo ""
    echo "[Install]"
    echo "WantedBy=default.target"
  } >"${UNIT_DIR}/ssh-mcp-pro-agent.service"
  systemctl --user daemon-reload
  # Ensure an existing agent process reloads the newly enrolled agent identity.
  systemctl --user enable ssh-mcp-pro-agent.service
  systemctl --user restart ssh-mcp-pro-agent.service
  # Allow the user service to keep running after logout / start on boot.
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  echo "install-agent: user service started — check 'systemctl --user status ssh-mcp-pro-agent'"
fi

echo "install-agent: done. Verify with: ${AGENT_BIN} status"
