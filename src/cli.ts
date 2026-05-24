export interface CliOptions {
  help: boolean;
  version: boolean;
  forceStdio: boolean;
  transport: "stdio" | "http";
  host?: string;
  port?: string;
  bearerTokenFile?: string;
  enableLegacySse: boolean;
  toolProfile?: string;
  connectorCredentialProvider?: string;
  unsupportedNoStdio: boolean;
  agentArgs?: string[];
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    help: false,
    version: false,
    forceStdio: false,
    transport: "stdio",
    enableLegacySse: false,
    unsupportedNoStdio: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "agent":
        opts.agentArgs = argv.slice(index + 1);
        index = argv.length;
        break;
      case "http":
        opts.transport = "http";
        break;
      case "stdio":
        opts.transport = "stdio";
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--version":
      case "-v":
        opts.version = true;
        break;
      case "--stdio":
        opts.forceStdio = true;
        opts.transport = "stdio";
        break;
      case "--transport=http":
        opts.transport = "http";
        break;
      case "--transport=stdio":
        opts.transport = "stdio";
        break;
      case "--host":
        {
          const next = argv[index + 1];
          if (next !== undefined) {
            opts.host = next;
            index++;
          }
        }
        break;
      case "--port":
        {
          const next = argv[index + 1];
          if (next !== undefined) {
            opts.port = next;
            index++;
          }
        }
        break;
      case "--bearer-token-file":
        {
          const next = argv[index + 1];
          if (next !== undefined) {
            opts.bearerTokenFile = next;
            index++;
          }
        }
        break;
      case "--enable-legacy-sse":
        opts.enableLegacySse = true;
        break;
      case "--tool-profile":
        {
          const next = argv[index + 1];
          if (next !== undefined) {
            opts.toolProfile = next;
            index++;
          }
        }
        break;
      case "--connector-credential-provider":
        {
          const next = argv[index + 1];
          if (next !== undefined) {
            opts.connectorCredentialProvider = next;
            index++;
          }
        }
        break;
      case "--no-stdio":
        opts.unsupportedNoStdio = true;
        break;
      default:
        // Ignore unknown flags to avoid breaking MCP client invocations.
        break;
    }
  }

  return opts;
}
