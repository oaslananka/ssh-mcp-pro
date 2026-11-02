# MCP protocol compatibility (2026-07-28)

This repository uses the official TypeScript v2 MCP SDK. The canonical SSH tool registry and policy checks are shared across the modern and legacy protocol eras; there is no second domain, gateway, or server deployment.

## Supported paths

- **stdio**: `serveStdio` negotiates the 2026-07-28 era and preserves the 2025 `initialize` handshake for legacy clients.
- **Standard `/mcp` HTTP**: the SDK's `createMcpHandler` handles modern per-request traffic. The existing session registry and Node Streamable HTTP transport still handle legacy sessionful traffic, selected using the SDK's `isLegacyRequest` classifier.
- **Legacy SSE**: the optional `/sse` and `/messages` endpoints use the official `server-legacy` compatibility transport. SSE remains disabled by default; do not remove it without a documented client compatibility decision.
- **Remote-agent control plane**: when its MCP routing is enabled, it remains a distinct authenticated, capability-scoped endpoint with its own request handling. It is **not yet advertised as 2026-07-28-capable**. Its modernization requires separate dual-era acceptance tests, not an authorization bypass to the standard SSH MCP endpoint.

## Security and operation

The existing HTTP router enforces authentication, origin policy, request-size limits, and public-boundary controls before dispatching either protocol era. The remote authorization server also includes the RFC 9207 issuer parameter on authorization-code redirects and advertises issuer-identification support in OAuth metadata. The modern SDK supplies header/body consistency validation, protocol discovery, default private/no-cache hints, and 2026 transport behavior. Do not use user-provided MCP metadata to authorize SSH host access; the existing authenticated identity and host policy remain authoritative.

Tool output schemas, structured results and annotations are preserved. New Tasks, Skills, interactive elicitation, and custom cache TTLs are not enabled without a concrete use case; protocol support does not require them.

## Acceptance

- `pnpm run check:quality`
- `pnpm run test:coverage`
- `pnpm run check:package`
- `pnpm exec vitest run --project integration test/integration/http-server-boundary.integration.test.ts`
- `pnpm exec vitest run --project unit test/unit/mcp-v2-transport.test.ts`

The HTTP boundary tests exercise modern SDK client discovery/tool calls, malformed modern header rejection, existing legacy session lifecycle, bearer/OAuth rejection and opt-in SSE routing. The stdio-era tests exercise both modern and legacy clients against the same tool contract. The remote-agent MCP path remains outside modern-era acceptance until explicitly implemented and tested.

Official migration references:

- https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
- https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- https://modelcontextprotocol.io/specification/2026-07-28
