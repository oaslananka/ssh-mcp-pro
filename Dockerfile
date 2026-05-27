# syntax=docker/dockerfile:1.7

FROM node:24-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate && pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json typedoc.json ./
COPY src ./src
RUN pnpm run build

FROM node:24-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f AS runtime
WORKDIR /app

ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="ssh-mcp-pro" \
      org.opencontainers.image.description="Secure MCP SSH automation server" \
      org.opencontainers.image.url="https://github.com/oaslananka/ssh-mcp-pro" \
      org.opencontainers.image.documentation="https://github.com/oaslananka/ssh-mcp-pro/blob/main/docs/docker.md" \
      org.opencontainers.image.source="https://github.com/oaslananka/ssh-mcp-pro" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && \
    corepack prepare pnpm@11.0.9 --activate && \
    pnpm install --prod --frozen-lockfile --ignore-scripts && \
    pnpm store prune

COPY --from=build /app/dist ./dist
COPY README.md LICENSE SECURITY.md SECURITY_DECISIONS.md ARCHITECTURE.md REGISTRY_SUBMISSION.md ./
COPY LICENSES ./LICENSES
COPY docs ./docs
COPY mcp.json server.json ./
COPY registry ./registry

RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node dist/index.js --version >/dev/null || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD []
