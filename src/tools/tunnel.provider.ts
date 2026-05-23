import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logging.js";
import type { TunnelService } from "../tunnel.js";
import {
  TunnelCloseSchema,
  TunnelListSchema,
  TunnelLocalForwardSchema,
  TunnelRemoteForwardSchema,
} from "../types.js";
import { annotate, objectOutputSchema } from "./metadata.js";
import type { ToolProvider } from "./types.js";

export interface TunnelToolProviderDeps {
  tunnelService: TunnelService;
}

export class TunnelToolProvider implements ToolProvider {
  readonly namespace = "tunnel";

  constructor(private readonly deps: TunnelToolProviderDeps) {}

  getTools(): Tool[] {
    return [
      {
        name: "tunnel_local_forward",
        description: "Creates a local SSH port forward",
        annotations: annotate({
          title: "Create Local SSH Tunnel",
          readOnly: false,
          destructive: false,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Local tunnel information"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            localPort: { type: "number", description: "Local TCP port" },
            remoteHost: { type: "string", description: "Remote host" },
            remotePort: { type: "number", description: "Remote TCP port" },
          },
          required: ["sessionId", "localPort", "remoteHost", "remotePort"],
        },
      },
      {
        name: "tunnel_remote_forward",
        description: "Creates a remote SSH port forward",
        annotations: annotate({
          title: "Create Remote SSH Tunnel",
          readOnly: false,
          destructive: false,
          idempotent: false,
        }),
        outputSchema: objectOutputSchema("Remote tunnel information"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "SSH session ID" },
            remotePort: { type: "number", description: "Remote TCP port" },
            localHost: { type: "string", description: "Local host" },
            localPort: { type: "number", description: "Local TCP port" },
          },
          required: ["sessionId", "remotePort", "localHost", "localPort"],
        },
      },
      {
        name: "tunnel_close",
        description: "Closes an active tunnel",
        annotations: annotate({
          title: "Close SSH Tunnel",
          readOnly: false,
          destructive: false,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Tunnel close result"),
        inputSchema: {
          type: "object" as const,
          properties: {
            tunnelId: { type: "string", description: "Tunnel identifier" },
          },
          required: ["tunnelId"],
        },
      },
      {
        name: "tunnel_list",
        description: "Lists active tunnels, optionally filtered by session",
        annotations: annotate({
          title: "List SSH Tunnels",
          readOnly: true,
          idempotent: true,
        }),
        outputSchema: objectOutputSchema("Active tunnels"),
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: {
              type: "string",
              description: "Optional SSH session ID filter",
            },
          },
          required: [],
        },
      },
    ];
  }

  handleTool(toolName: string, args: unknown): Promise<unknown> | undefined {
    switch (toolName) {
      case "tunnel_local_forward":
        return this.localForward(args);
      case "tunnel_remote_forward":
        return this.remoteForward(args);
      case "tunnel_close":
        return this.close(args);
      case "tunnel_list":
        return this.list(args);
      default:
        return undefined;
    }
  }

  private async localForward(args: unknown): Promise<unknown> {
    const params = TunnelLocalForwardSchema.parse(args);
    const result = await this.deps.tunnelService.createLocalForward(
      params.sessionId,
      params.localPort,
      params.remoteHost,
      params.remotePort,
    );
    logger.info("Local tunnel created", {
      sessionId: params.sessionId,
      localPort: params.localPort,
      remoteHost: params.remoteHost,
      remotePort: params.remotePort,
    });
    return result;
  }

  private async remoteForward(args: unknown): Promise<unknown> {
    const params = TunnelRemoteForwardSchema.parse(args);
    const result = await this.deps.tunnelService.createRemoteForward(
      params.sessionId,
      params.remotePort,
      params.localHost,
      params.localPort,
    );
    logger.info("Remote tunnel created", {
      sessionId: params.sessionId,
      remotePort: params.remotePort,
      localHost: params.localHost,
      localPort: params.localPort,
    });
    return result;
  }

  private async close(args: unknown): Promise<unknown> {
    const params = TunnelCloseSchema.parse(args);
    return this.deps.tunnelService.closeTunnel(params.tunnelId);
  }

  private async list(args: unknown): Promise<unknown> {
    const params = TunnelListSchema.parse(args ?? {});
    return this.deps.tunnelService.listTunnels(params.sessionId);
  }
}
