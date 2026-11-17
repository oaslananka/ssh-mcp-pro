# ssh-mcp-pro · Gemini Apps, Connected Apps and Gemini CLI

## Gemini Apps web (custom connected app)

As documented in the [Gemini custom-app Help Center](https://support.google.com/gemini/answer/17209137), **eligible users** can connect a remote MCP server from [Gemini Connected Apps](https://gemini.google.com/) and use the resulting app in Gemini web/mobile.

Google currently restricts **custom Connected Apps** to personal Google Accounts in the **United States**, users aged 18+, English, and enabled Gemini History. Regional and account eligibility is a Google product restriction, not an MCP server defect. **No live Gemini Apps acceptance from an eligible account is claimed here.**

To test when eligible:

1. Open Gemini web → Settings → Connected Apps → Custom apps → Add a custom app.
2. Enter https://ssh-mcp-pro.oaslananka.dev/mcp.
3. Select Dynamic Client Registration, follow OAuth login, and approve minimal read-only scopes.
4. Inspect @ssh-mcp-pro tool discovery, connector_status, host inspection, and denied writes using [Gemini Apps Developer Mode](https://gemini.google.com/devmode).
5. Check that the connector is recorded under **AI clients** for the **same** authenticated account; revoke and verify refresh access is denied. Test multi-account isolation independently.

The [Google Connected Apps Platform](https://developers.google.com/connected-apps) has a separate preview/developer-console and publication review workflow. A working custom URL does not establish a public Connected Apps directory listing.

## Gemini CLI extension

The root gemini-extension.json is a **separate** Gemini CLI extension. It uses an npx launch of the published npm package so a GitHub installation works **without** a checked-in dist/ folder.

Install from the repository (requires Node.js and npm/npx on the user's PATH):

~~~bash
gemini extensions install https://github.com/oaslananka/ssh-mcp-pro
gemini extensions list
~~~

The extension launches the ssh-mcp-pro@latest stable npm CLI through stdio and loads AGENTS.md context. The local stdio route is independent of Gemini Apps web; do not treat a CLI extension as a Gemini web publication.

## Live metadata and safeguards

- HTTPS MCP: https://ssh-mcp-pro.oaslananka.dev/mcp
- Protected resource metadata: https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-protected-resource
- OAuth discovery: https://ssh-mcp-pro.oaslananka.dev/.well-known/oauth-authorization-server
- Authentication: OAuth authorization-code + PKCE S256 with DCR and user-scoped grants.
- The default gemini connector profile is read-only with safe planning. Host allowlists, strict host keys, credential isolation and mutation policy still apply.

Run pnpm run validate:google-app, the OAuth integration tests and live metadata checks before attempting any platform listing. User-facing public submission stays blocked until eligible host acceptance and publisher review are verified; publishReady remains **false**.
