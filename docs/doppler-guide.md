# Doppler secrets for hosted SSH MCP Pro

Hosted deployments use **Coolify's native Doppler secret-manager integration**. The app must not require a Doppler CLI process, an extra credential in the container, or a GitHub Actions `DOPPLER_TOKEN` merely to start.

## Configure once

1. In Coolify, open **Keys & Tokens → Integration Tokens** and configure a Doppler token with access only to the intended project/config. Prefer a service token scoped to one environment.
2. Open the SSH MCP Pro application and select **Environment Variables → Secret manager**. Attach the existing Doppler integration token. If the token does not already fix a project and config, enter the correct project and config.
3. Add the following runtime environment variable **references** in Coolify. The values are placeholders resolved by Coolify at deployment; the provider secrets themselves must not be copied into GitHub or the image.

   ```dotenv
   GITHUB_CLIENT_ID={{vault.GITHUB_CLIENT_ID}}
   GITHUB_CLIENT_SECRET={{vault.GITHUB_CLIENT_SECRET}}
   GOOGLE_CLIENT_ID={{vault.GOOGLE_CLIENT_ID}}
   GOOGLE_CLIENT_SECRET={{vault.GOOGLE_CLIENT_SECRET}}
   ```

4. Keep non-secret settings such as `PUBLIC_BASE_URL`, `MCP_RESOURCE_URL`, callback URLs and port configuration as normal Coolify environment variables. For the SQLite single-instance deployment, use `DATABASE_URL=file:/app/data/sshautomator.db` and persist **/app/data** for the database and both signing-key files.
5. Keep `AUTH_ALLOW_ALL_USERS=false` until real multi-user isolation and OAuth acceptance tests pass. Configure account allowlists intentionally, without embedding personal accounts in public documentation.

Coolify resolves `{{vault.KEY}}` references at startup or deployment and does not store the resolved provider values in its application configuration. A missing provider key should block deployment instead of falling back to an anonymous or insecure mode.

## Operations

- Rotate or update values in Doppler, then restart the application for runtime-only secrets or redeploy when build-time values changed.
- Verify both GitHub and Google callback routes, OAuth issuer/audience/nonce validation, authorization decisions and device enrollment before public launch.
- Protect the persistent SQLite data and signing keys with an independently recoverable backup. Keep only the production replica and a verified rollback image.
- Never expose a Doppler service token, Google/GitHub client secret, access token, callback code, or full environment dump in logs or issue reports.

## Local development

Local work can use the existing `doppler run -- pnpm run start:http` workflow, or a local non-committed `.env` file. The local bootstrap script is optional and does not modify the Coolify integration.

See [Coolify deployment](coolify.md) for build and data paths and [Coolify's secret-manager documentation](https://coolify.io/docs/integrations/security/using-secret-managers) for the current integration UI.
