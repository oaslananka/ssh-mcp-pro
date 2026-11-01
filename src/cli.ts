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

const VALUE_OPTIONS = new Map<
  string,
  "host" | "port" | "bearerTokenFile" | "toolProfile" | "connectorCredentialProvider"
>([
  ["--host", "host"],
  ["--port", "port"],
  ["--bearer-token-file", "bearerTokenFile"],
  ["--tool-profile", "toolProfile"],
  ["--connector-credential-provider", "connectorCredentialProvider"],
]);

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
    const valueOption = VALUE_OPTIONS.get(arg ?? "");
    if (valueOption) {
      const next = argv[index + 1];
      if (next !== undefined) {
        opts[valueOption] = next;
        index++;
      }
      continue;
    }
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
      case "--enable-legacy-sse":
        opts.enableLegacySse = true;
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
