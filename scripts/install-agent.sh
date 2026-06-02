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
SCOPE="user"

die() {
  echo "install-agent: $1" >&2
  exit 1
}

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
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
      SCOPE="system"
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

[ -n "$SERVER" ] || die "--server is required"
[ -n "$TOKEN" ] || die "--token is required"
[ -n "$ALIAS" ] || die "--alias must not be empty"

command -v node >/dev/null 2>&1 || die "node is not installed (need Node 22.22+ or 24+)"
command -v npm >/dev/null 2>&1 || die "npm is not installed"

# WebSocket is exposed as a global from Node 22.22+ (and all of 23/24+).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 22 ]; }; then
  die "Node $(node -v) is too old; install Node 22.22+ or 24+"
fi

if [ "$SCOPE" = "system" ] && [ "$(id -u)" -ne 0 ]; then
  die "--system requires root; re-run with sudo"
fi

echo "install-agent: installing ssh-mcp-pro@${VERSION} globally"
npm install -g "ssh-mcp-pro@${VERSION}"

AGENT_BIN="$(command -v ssh-mcp-pro-agent)" || die "ssh-mcp-pro-agent not found on PATH after install"
NODE_BIN="$(command -v node)"

echo "install-agent: enrolling as alias '${ALIAS}'"
"$AGENT_BIN" enroll --server "$SERVER" --token "$TOKEN" --alias "$ALIAS"

write_unit() {
  cat <<EOF
[Unit]
Description=ssh-mcp-pro outbound agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${AGENT_BIN} run
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=5
EOF
}

if [ "$SCOPE" = "system" ]; then
  RUN_USER="${SUDO_USER:-root}"
  RUN_HOME="$(eval echo "~${RUN_USER}")"
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
  systemctl enable --now ssh-mcp-pro-agent.service
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
  systemctl --user enable --now ssh-mcp-pro-agent.service
  # Allow the user service to keep running after logout / start on boot.
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  echo "install-agent: user service started — check 'systemctl --user status ssh-mcp-pro-agent'"
fi

echo "install-agent: done. Verify with: ${AGENT_BIN} status"
