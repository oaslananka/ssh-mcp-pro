# Docker Usage

Build the local production image:

```bash
docker build -t ssh-mcp-pro:local .
```

Run CLI smoke checks:

```bash
docker run --rm ssh-mcp-pro:local --version
docker run --rm ssh-mcp-pro:local --help
```

Verify license evidence in release artifacts:

```bash
pnpm run pack:check
docker run --rm --entrypoint sh ssh-mcp-pro:local -c 'test -f LICENSE && test -f LICENSES/MIT.txt'
```

Run the HTTP transport on loopback on Linux hosts that support host networking:

```bash
docker run --rm --network host ssh-mcp-pro:local http --host 127.0.0.1 --port 3000
```

For bridge or port-mapped containers, binding inside the container to `0.0.0.0` is a non-loopback HTTP deployment. Configure bearer or OAuth auth, allowed origins, `SSH_MCP_HTTP_PUBLIC_URL`, `SSH_MCP_ALLOWED_HOSTS`, strict host-key verification, and a remote-safe tool profile. The process refuses unsafe public bindings at startup.
