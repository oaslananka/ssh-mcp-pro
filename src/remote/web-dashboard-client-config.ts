export function createDashboardClientConfigs(publicUrl: string, mcpUrl: string) {
  const configs = {
    endpoints: {
      webEndpoint: mcpUrl,
      publicBaseUrl: publicUrl,
      transport: "streamable-http",
      auth: "OAuth 2.1 PKCE (RFC 9728 & RFC 8414)",
    },
    clients: {
      claudeRemoteConnector: {
        serverUrl: mcpUrl,
        setup: "Claude > Customize > Connectors > Add custom connector",
        authentication: "OAuth via server metadata discovery",
      },
      claudeCodeRemote: {
        command: `claude mcp add --transport http ssh-mcp-pro ${mcpUrl}`,
      },
      claudeDesktopLocal: {
        mcpServers: {
          "ssh-mcp-pro": {
            command: "ssh-mcp-pro",
            args: [],
          },
        },
      },
      chatgptMcpPlugin: {
        serverUrl: mcpUrl,
        setup: "ChatGPT > Plugins > Add custom MCP server",
        authentication: "OAuth via server metadata discovery",
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
