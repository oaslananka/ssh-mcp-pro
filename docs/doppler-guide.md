# Doppler Secret Management Guide

`ssh-mcp-pro` centralizes all environment variables and secrets in [Doppler](https://doppler.com).

## Overview

- **Project Name:** `ssh-mcp-pro`
- **Config:** `main` (production / default)
- **GitHub Secret:** Only a single secret `DOPPLER_TOKEN` is required in GitHub repository settings.

---

## 1. Quick Doppler Setup

Run the initialization script from the repository root:

```bash
./scripts/doppler-init.sh
```

This populates the baseline configurations:
- `PUBLIC_BASE_URL`: `https://ssh-mcp-pro.oaslananka.dev`
- `MCP_RESOURCE_URL`: `https://ssh-mcp-pro.oaslananka.dev/mcp`
- `SSH_MCP_REMOTE_AGENT_CONTROL_PLANE`: `true`
- `SSH_MCP_HTTP_HOST`: `0.0.0.0`
- `SSH_MCP_HTTP_PORT`: `3000`
- `SSH_MCP_HTTP_ALLOWED_ORIGINS`: `https://ssh-mcp-pro.oaslananka.dev,https://chatgpt.com,https://chat.openai.com,http://localhost:3000`
- `DATABASE_URL`: `file:./data/ssh-mcp-pro.db`
- `GITHUB_CALLBACK_URL`: `https://ssh-mcp-pro.oaslananka.dev/oauth/callback/github`
- `GOOGLE_CALLBACK_URL`: `https://ssh-mcp-pro.oaslananka.dev/oauth/callback/google`

---

## 2. Setting OAuth Secrets in Doppler

Set your sensitive OAuth client secrets directly in Doppler:

```bash
# Google OAuth
doppler secrets set GOOGLE_CLIENT_ID="<your-google-client-id>" \
                    GOOGLE_CLIENT_SECRET="<your-google-client-secret>"

# GitHub OAuth
doppler secrets set GITHUB_CLIENT_ID="<your-github-client-id>" \
                    GITHUB_CLIENT_SECRET="<your-github-client-secret>"
```

Optional user allowlists:
```bash
doppler secrets set AUTH_ALLOW_ALL_USERS="true"
# Or restrict to specific accounts:
# doppler secrets set AUTH_ALLOWED_GOOGLE_EMAILS="yourname@gmail.com"
# doppler secrets set AUTH_ALLOWED_GITHUB_LOGINS="oaslananka"
```

---

## 3. GitHub Actions Secret Integration

You do **NOT** need to add multiple secrets to GitHub!

1. In the **Doppler Dashboard**:
   - Go to Project **ssh-mcp-pro**
   - Click on **Configs** -> **main**
   - Click **Access** -> **Generate Service Token**
   - Name it `github-actions-ci`
2. In **GitHub Repository Settings**:
   - Go to **Settings** -> **Secrets and variables** -> **Actions**
   - Click **New repository secret**
   - Name: `DOPPLER_TOKEN`
   - Value: paste the service token (`dp.st.main...`)

The GitHub Actions workflows will automatically fetch all required secrets (including SonarQube token, API keys, etc.) on demand.

---

## 4. Running the Platform with Doppler

### Locally:
```bash
doppler run -- pnpm run start:http
```

### In Production / Systemd / Docker:
With Doppler installed on your VPS/server:
```bash
doppler run -- node dist/render-http.js
```
Or with Docker:
```bash
docker run -e DOPPLER_TOKEN="dp.st.main..." my-image doppler run -- node dist/render-http.js
```
