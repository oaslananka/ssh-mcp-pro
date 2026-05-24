import type { IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { describe, expect, test } from "vitest";
import { acceptWebSocketUpgrade, MinimalWebSocketConnection } from "../../src/remote/websocket.js";

class FakeSocket extends Duplex {
  readonly writes: Buffer[] = [];
  destroyedByConnection = false;

  _read(): void {}

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk));
    callback();
  }

  override destroy(error?: Error): this {
    this.destroyedByConnection = true;
    return super.destroy(error);
  }
}

function websocketRequest(key?: string): IncomingMessage {
  return {
    headers: key === undefined ? {} : { "sec-websocket-key": key },
  } as IncomingMessage;
}

function maskedFrame(opcode: number, body: string | Buffer): Buffer {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const header =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
      : Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = (masked[index] ?? 0) ^ (mask[index % mask.length] ?? 0);
  }
  return Buffer.concat([header, mask, masked]);
}

function oversizedFrameHeader(): Buffer {
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 2);
  return header;
}

function tooLargeFrameHeader(): Buffer {
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(1_048_577n, 2);
  return header;
}

function decodeServerFrame(frame: Buffer): { opcode: number; payload: string } {
  const opcode = frame[0] ?? 0;
  const lengthMarker = frame[1] ?? 0;
  let offset = 2;
  let length = lengthMarker & 0x7f;
  if (length === 126) {
    length = frame.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    length = Number(frame.readBigUInt64BE(2));
    offset = 10;
  }
  return {
    opcode: opcode & 0x0f,
    payload: frame.subarray(offset, offset + length).toString("utf8"),
  };
}

describe("minimal remote WebSocket", () => {
  test("drains masked text frames after enough bytes arrive and sends JSON frames", () => {
    const socket = new FakeSocket();
    const connection = new MinimalWebSocketConnection(socket);
    const messages: string[] = [];
    const frame = maskedFrame(0x1, "hello");

    connection.onText((message) => messages.push(message));
    socket.emit("data", frame.subarray(0, 2));
    expect(messages).toEqual([]);

    socket.emit("data", frame.subarray(2));
    expect(messages).toEqual(["hello"]);

    connection.sendJson({ ok: true });
    expect(decodeServerFrame(socket.writes.at(-1) ?? Buffer.alloc(0))).toEqual({
      opcode: 0x1,
      payload: JSON.stringify({ ok: true }),
    });
  });

  test("handles extended payloads, pings, close frames, and closed sends", () => {
    const socket = new FakeSocket();
    const connection = new MinimalWebSocketConnection(socket);
    const messages: string[] = [];
    let closes = 0;

    connection.onText((message) => messages.push(message));
    connection.onClose(() => {
      closes += 1;
    });
    socket.emit("data", maskedFrame(0x1, "x".repeat(130)));
    expect(messages).toEqual(["x".repeat(130)]);

    socket.emit("data", maskedFrame(0x9, "ping"));
    expect(decodeServerFrame(socket.writes.at(-1) ?? Buffer.alloc(0))).toEqual({
      opcode: 0x0a,
      payload: "ping",
    });

    socket.emit("data", maskedFrame(0x8, ""));
    const writesAfterClose = socket.writes.length;
    expect(closes).toBe(1);

    connection.sendText("ignored");
    expect(socket.writes).toHaveLength(writesAfterClose);
  });

  test("closes oversized frames and destroys oversized initial buffers", () => {
    const socket = new FakeSocket();
    const connection = new MinimalWebSocketConnection(socket);
    let closes = 0;
    connection.onClose(() => {
      closes += 1;
    });

    socket.emit("data", oversizedFrameHeader());

    expect(closes).toBe(1);
    expect(decodeServerFrame(socket.writes.at(-1) ?? Buffer.alloc(0)).opcode).toBe(0x8);

    const initialSocket = new FakeSocket();
    new MinimalWebSocketConnection(initialSocket, Buffer.alloc(1_048_577));
    expect(initialSocket.destroyedByConnection).toBe(true);
  });

  test("waits for incomplete extended headers and writes large outbound frames", () => {
    const partial16 = new FakeSocket();
    new MinimalWebSocketConnection(partial16);
    partial16.emit("data", Buffer.from([0x81, 126, 0x00]));
    expect(partial16.writes).toEqual([]);

    const partial64 = new FakeSocket();
    new MinimalWebSocketConnection(partial64);
    partial64.emit("data", Buffer.from([0x81, 127, 0, 0]));
    expect(partial64.writes).toEqual([]);

    const tooLarge = new FakeSocket();
    new MinimalWebSocketConnection(tooLarge);
    tooLarge.emit("data", tooLargeFrameHeader());
    expect(decodeServerFrame(tooLarge.writes.at(-1) ?? Buffer.alloc(0)).opcode).toBe(0x8);

    const outbound = new FakeSocket();
    const connection = new MinimalWebSocketConnection(outbound);
    connection.sendText("y".repeat(70_000));
    const frame = outbound.writes.at(-1) ?? Buffer.alloc(0);
    expect(frame[1]).toBe(127);
    expect(decodeServerFrame(frame).payload).toHaveLength(70_000);
  });

  test("accepts valid upgrades and rejects requests without websocket keys", () => {
    const socket = new FakeSocket();
    const connection = acceptWebSocketUpgrade(websocketRequest("dGhlIHNhbXBsZSBub25jZQ=="), socket);

    expect(connection).toBeInstanceOf(MinimalWebSocketConnection);
    expect(socket.writes[0]?.toString("utf8")).toContain("HTTP/1.1 101 Switching Protocols");
    expect(socket.writes[0]?.toString("utf8")).toContain(
      "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
    );

    const rejected = new FakeSocket();
    expect(() => acceptWebSocketUpgrade(websocketRequest(), rejected)).toThrow(
      "Missing Sec-WebSocket-Key",
    );
    expect(rejected.destroyedByConnection).toBe(true);
  });
});
