#!/usr/bin/env bash
#
# doppler-init.sh — Initialize recommended configuration keys in Doppler
# for ssh-mcp-pro.oaslananka.dev (project: ssh-mcp-pro, config: main)
#

set -euo pipefail

echo "==> Initializing Doppler configuration for ssh-mcp-pro.oaslananka.dev..."

if ! command -v doppler >/dev/null 2>&1; then
  echo "Error: doppler CLI is not installed." >&2
  exit 1
fi

doppler secrets set \
  PUBLIC_BASE_URL="https://ssh-mcp-pro.oaslananka.dev" \
  MCP_RESOURCE_URL="https://ssh-mcp-pro.oaslananka.dev/mcp" \
  SSH_MCP_REMOTE_AGENT_CONTROL_PLANE="true" \
  SSHAUTOMATOR_REMOTE_AGENT_CONTROL_PLANE="true" \
  SSH_MCP_HTTP_HOST="0.0.0.0" \
  SSH_MCP_HTTP_PORT="3000" \
  SSH_MCP_HTTP_ALLOWED_ORIGINS="https://ssh-mcp-pro.oaslananka.dev,https://chatgpt.com,https://chat.openai.com,http://localhost:3000" \
  DATABASE_URL="file:./data/ssh-mcp-pro.db" \
  LOG_LEVEL="info" \
  LOG_FORMAT="json" \
  ACCESS_TOKEN_TTL_SECONDS="900" \
  AUTH_CODE_TTL_SECONDS="300" \
  ENROLLMENT_TOKEN_TTL_SECONDS="600" \
  GITHUB_CALLBACK_URL="https://ssh-mcp-pro.oaslananka.dev/oauth/callback/github" \
  GOOGLE_CALLBACK_URL="https://ssh-mcp-pro.oaslananka.dev/oauth/callback/google" \
  AUTH_ALLOW_ALL_USERS="true" \
  CONTROL_PLANE_SIGNING_KEY_PATH="./data/control-plane-ed25519.json" \
  JWT_SIGNING_KEY_PATH="./data/jwt-ed25519.json"

echo ""
echo "==> Baseline configurations set in Doppler."
echo "==> Please set your sensitive OAuth secrets when ready:"
echo "    doppler secrets set GOOGLE_CLIENT_ID=\"...\" GOOGLE_CLIENT_SECRET=\"...\""
echo "    doppler secrets set GITHUB_CLIENT_ID=\"...\" GITHUB_CLIENT_SECRET=\"...\""
echo ""
echo "==> For GitHub Actions:"
echo "    1. In Doppler dashboard: Project ssh-mcp-pro -> Configs -> Access -> Generate Service Token"
echo "    2. In GitHub repo Settings -> Secrets and variables -> Actions:"
echo "       Add secret 'DOPPLER_TOKEN' with the service token value."
echo "    No other secrets need to be added to GitHub!"
