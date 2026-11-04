export function createDashboardClientConfigs(publicUrl: string, mcpUrl: string) {
  const configs = {
    endpoints: {
      webEndpoint: mcpUrl,
      publicBaseUrl: publicUrl,
      transport: "streamable-http",
      auth: "OAuth 2.1 PKCE (RFC 9728 & RFC 8414)",
    },
    clients: {
      claudeDesktopRemote: {
        mcpServers: {
          "ssh-mcp-pro": {
            url: mcpUrl,
            transport: "streamable-http",
          },
        },
      },
      claudeDesktopLocal: {
        mcpServers: {
          "ssh-mcp-pro": {
            command: "ssh-mcp-pro",
            args: [],
          },
        },
      },
      chatgptCustomGpt: {
        actionServerUrl: mcpUrl,
        authentication: "OAuth 2.0 (Authorization Code + PKCE)",
        authorizationUrl: `${publicUrl}/oauth/authorize`,
        tokenUrl: `${publicUrl}/oauth/token`,
        scope: "hosts:read agents:read status:read logs:read",
      },
      geminiExtension: {
        mcpEndpoint: mcpUrl,
        transport: "streamable-http",
        auth: "OAuth 2.1 (RFC 9728 discovery)",
      },
      vscodeCursor: {
        servers: {
          "ssh-mcp-pro-cloud": {
            type: "http",
            url: mcpUrl,
          },
          "ssh-mcp-pro-local": {
            type: "stdio",
            command: "ssh-mcp-pro",
            args: [],
          },
        },
      },
      cursor: {
        mcpServers: {
          "ssh-mcp-pro": {
            url: mcpUrl,
          },
        },
      },
      windsurf: {
        mcpServers: {
          "ssh-mcp-pro": {
            serverUrl: mcpUrl,
          },
        },
      },
    },
  };
  return configs;
}
