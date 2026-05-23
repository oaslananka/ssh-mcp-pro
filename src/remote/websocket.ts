import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export type WebSocketTextHandler = (message: string) => void;
export type WebSocketCloseHandler = () => void;

export class MinimalWebSocketConnection {
  private static readonly MAX_FRAME_BYTES = 1_048_576;
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private closed = false;
  private closeNotified = false;
  private readonly textHandlers = new Set<WebSocketTextHandler>();
  private readonly closeHandlers = new Set<WebSocketCloseHandler>();

  constructor(
    private readonly socket: Duplex,
    initialBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  ) {
    if (initialBuffer.length > MinimalWebSocketConnection.MAX_FRAME_BYTES) {
      socket.destroy();
    } else {
      this.buffer = initialBuffer;
    }
    socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("end", () => this.handleClose());
    socket.on("error", () => this.handleClose());
  }

  onText(handler: WebSocketTextHandler): void {
    this.textHandlers.add(handler);
    this.drainFrames();
  }

  onClose(handler: WebSocketCloseHandler): void {
    this.closeHandlers.add(handler);
  }

  sendJson(value: unknown): void {
    this.sendText(JSON.stringify(value));
  }

  sendText(value: string): void {
    if (this.closed) {
      return;
    }
    const payload = Buffer.from(value, "utf8");
    const header = this.createFrameHeader(payload.length, 0x1);
    this.socket.write(Buffer.concat([header, payload]));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.end(Buffer.from([0x88, 0x00]));
    this.notifyClose();
  }

  private handleData(chunk: Buffer): void {
    if (this.buffer.length + chunk.length > MinimalWebSocketConnection.MAX_FRAME_BYTES) {
      this.close();
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drainFrames();
  }

  private drainFrames(): void {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0] ?? 0;
      const second = this.buffer[1] ?? 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) {
          return;
        }
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) {
          return;
        }
        const longLength = this.buffer.readBigUInt64BE(2);
        if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.close();
          return;
        }
        length = Number(longLength);
        offset = 10;
      }

      if (length > MinimalWebSocketConnection.MAX_FRAME_BYTES) {
        this.close();
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) {
        return;
      }
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);

      if (mask) {
        for (let index = 0; index < payload.length; index++) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this.socket.write(Buffer.concat([this.createFrameHeader(payload.length, 0x0a), payload]));
        continue;
      }
      if (opcode === 0x1) {
        const message = payload.toString("utf8");
        for (const handler of this.textHandlers) {
          handler(message);
        }
      }
    }
  }

  private createFrameHeader(length: number, opcode: number): Buffer {
    if (length < 126) {
      return Buffer.from([0x80 | opcode, length]);
    }
    if (length <= 0xffff) {
      const header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
      return header;
    }
    const header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
    return header;
  }

  private handleClose(): void {
    this.closed = true;
    this.notifyClose();
  }

  private notifyClose(): void {
    if (this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    for (const handler of this.closeHandlers) {
      handler();
    }
  }
}

export function acceptWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): MinimalWebSocketConnection {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    throw new Error("Missing Sec-WebSocket-Key");
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  return new MinimalWebSocketConnection(socket, head);
}
