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

Run the HTTP transport on loopback:

```bash
docker run --rm -p 127.0.0.1:3000:3000 ssh-mcp-pro:local http --host 0.0.0.0 --port 3000
```

For non-loopback HTTP deployments, configure bearer or OAuth auth, allowed origins, `SSH_MCP_HTTP_PUBLIC_URL`, `SSH_MCP_ALLOWED_HOSTS`, strict host-key verification, and a remote-safe tool profile. The process refuses unsafe public bindings at startup.
