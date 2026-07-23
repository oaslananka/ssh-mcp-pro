import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";

export const MAX_AGENT_WEBSOCKET_MESSAGE_BYTES = 1_048_576;

export type WebSocketTextHandler = (message: string) => void;
export type WebSocketCloseHandler = (code: number, reason: string) => void;
export type WebSocketPongHandler = () => void;

export interface WebSocketConnection {
  onText(handler: WebSocketTextHandler): void;
  onClose(handler: WebSocketCloseHandler): void;
  onPong(handler: WebSocketPongHandler): void;
  sendJson(value: unknown): void;
  sendText(value: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readonly isOpen: boolean;
  readonly isClosed: boolean;
}

const upgradeServer = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  maxPayload: MAX_AGENT_WEBSOCKET_MESSAGE_BYTES,
  perMessageDeflate: false,
});

upgradeServer.on("wsClientError", (_error, socket) => {
  socket.destroy();
});

/**
 * Small application-facing adapter around the maintained `ws` protocol implementation.
 *
 * `ws` owns RFC 6455 framing, masking, fragmentation, UTF-8 validation, control-frame
 * validation, close-code validation, and payload limits. This adapter intentionally exposes
 * only the text-message and lifecycle operations needed by the remote agent control plane.
 */
export class MinimalWebSocketConnection implements WebSocketConnection {
  private closeNotified = false;
  private closeCode = 1006;
  private closeReason = "";
  private readonly textHandlers = new Set<WebSocketTextHandler>();
  private readonly closeHandlers = new Set<WebSocketCloseHandler>();
  private readonly pongHandlers = new Set<WebSocketPongHandler>();

  constructor(private readonly websocket: WebSocket) {
    websocket.on("message", (data, isBinary) => this.handleMessage(data, isBinary));
    websocket.on("pong", () => {
      for (const handler of this.pongHandlers) {
        handler();
      }
    });
    websocket.on("close", (code, reason) => {
      this.closeCode = code;
      this.closeReason = reason.toString("utf8");
      this.notifyClose();
    });
    websocket.on("error", () => {
      if (websocket.readyState === WebSocket.CLOSED) {
        this.notifyClose();
      }
    });
  }

  get isOpen(): boolean {
    return this.websocket.readyState === WebSocket.OPEN;
  }

  get isClosed(): boolean {
    return this.websocket.readyState === WebSocket.CLOSED;
  }

  onText(handler: WebSocketTextHandler): void {
    this.textHandlers.add(handler);
  }

  onClose(handler: WebSocketCloseHandler): void {
    this.closeHandlers.add(handler);
    if (this.closeNotified) {
      handler(this.closeCode, this.closeReason);
    }
  }

  onPong(handler: WebSocketPongHandler): void {
    this.pongHandlers.add(handler);
  }

  sendJson(value: unknown): void {
    this.sendText(JSON.stringify(value));
  }

  sendText(value: string): void {
    if (!this.isOpen) {
      return;
    }
    const payload = Buffer.from(value, "utf8");
    if (payload.length > MAX_AGENT_WEBSOCKET_MESSAGE_BYTES) {
      this.close(1009, "message too large");
      return;
    }
    this.websocket.send(payload, { binary: false });
  }

  ping(): void {
    if (this.isOpen) {
      this.websocket.ping();
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.websocket.readyState === WebSocket.CONNECTING) {
      this.websocket.terminate();
      return;
    }
    if (this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.close(code, reason);
    }
  }

  terminate(): void {
    if (!this.isClosed) {
      this.websocket.terminate();
    }
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.close(1003, "text messages required");
      return;
    }
    const message = rawDataToBuffer(data).toString("utf8");
    for (const handler of this.textHandlers) {
      handler(message);
    }
  }

  private notifyClose(): void {
    if (this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    for (const handler of this.closeHandlers) {
      handler(this.closeCode, this.closeReason);
    }
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.concat(data);
}

export type WebSocketAcceptedHandler = (connection: MinimalWebSocketConnection) => void;

export function acceptWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  onAccepted: WebSocketAcceptedHandler,
): void {
  upgradeServer.handleUpgrade(req, socket, Buffer.from(head), (websocket) => {
    onAccepted(new MinimalWebSocketConnection(websocket));
  });
}
