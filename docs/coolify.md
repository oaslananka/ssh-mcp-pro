# Coolify deployment

Deploy the repository with **Dockerfile** build pack and Dockerfile path `Dockerfile.coolify`.

- Domain: `https://ssh-mcp-pro.oaslananka.dev`
- Container port: `3000` (do not expose the port directly to the internet)
- Persistent volume: mount a named volume at `/app/data` (SQLite database and signing keys)
- One replica: SQLite is local and is not a shared multi-instance database
- Start command: baked into `Dockerfile.coolify` (`node dist/render-http.js`)

Configure secrets in Coolify (never commit them): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the project's other required credentials. Set:

```dotenv
NODE_ENV=production
PUBLIC_BASE_URL=https://ssh-mcp-pro.oaslananka.dev
MCP_RESOURCE_URL=https://ssh-mcp-pro.oaslananka.dev/mcp
SSH_MCP_REMOTE_AGENT_CONTROL_PLANE=true
SSH_MCP_HTTP_HOST=0.0.0.0
SSH_MCP_HTTP_PORT=3000
DATABASE_URL=file:/app/data/sshautomator.db
CONTROL_PLANE_SIGNING_KEY_PATH=/app/data/control-plane-ed25519.json
JWT_SIGNING_KEY_PATH=/app/data/jwt-ed25519.json
GOOGLE_CALLBACK_URL=https://ssh-mcp-pro.oaslananka.dev/oauth/callback/google
GITHUB_CALLBACK_URL=https://ssh-mcp-pro.oaslananka.dev/oauth/callback/github
```

Dashboard login callback URLs additionally use `/auth/callback/google` and `/auth/callback/github`; register both with the relevant OAuth providers. Keep authentication allowlists configured as appropriate. Do not enable anonymous access as a workaround.

Before deployment verify local OAuth login, dashboard and MCP flow. After deployment check health, login callbacks, device connectivity, and persistent state across a controlled restart. Do not run the SSH test fixture service in production.
