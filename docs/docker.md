# Docker Usage

Published release images are available from GitHub Container Registry:

```bash
docker pull ghcr.io/oaslananka/ssh-mcp-pro:1.0.0
docker run --rm ghcr.io/oaslananka/ssh-mcp-pro:1.0.0 --version
```

Each release publishes a multi-platform OCI image for `linux/amd64` and
`linux/arm64`. The release workflow publishes two exact tags:

- `ghcr.io/oaslananka/ssh-mcp-pro:<semver>` such as `1.0.0`
- `ghcr.io/oaslananka/ssh-mcp-pro:<git-tag>` such as `v1.0.0`

The project does not publish a mutable `latest` tag. Prefer digest-pinned
references in production so container deployments match the npm package,
GitHub Release, and MCP metadata that were verified for the same version:

```bash
docker pull ghcr.io/oaslananka/ssh-mcp-pro@sha256:<release-digest>
docker run --rm ghcr.io/oaslananka/ssh-mcp-pro@sha256:<release-digest> --help
```

The release workflow records the manifest digest, verifies that both release
tags resolve to that digest, checks the `linux/amd64` and `linux/arm64`
manifests, and queries the GHCR package version metadata after publication.

Build the local production image:

```bash
docker build -t ssh-mcp-pro:local .
```

Run CLI smoke checks:

```bash
docker run --rm ssh-mcp-pro:local --version
docker run --rm ssh-mcp-pro:local --help
```

Verify the Dockerfile supports the release platforms:

```bash
docker buildx build --check --platform linux/amd64,linux/arm64 .
```

Run the HTTP transport on loopback on Linux hosts that support host networking:

```bash
docker run --rm --network host ssh-mcp-pro:local http --host 127.0.0.1 --port 3000
```

For bridge or port-mapped containers, binding inside the container to `0.0.0.0` is a non-loopback HTTP deployment. Configure bearer or OAuth auth, allowed origins, `SSH_MCP_HTTP_PUBLIC_URL`, `SSH_MCP_ALLOWED_HOSTS`, strict host-key verification, and a remote-safe tool profile. The process refuses unsafe public bindings at startup.
