import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import WebSocket from "ws";
import { afterEach, describe, expect, test } from "vitest";
import {
  acceptWebSocketUpgrade,
  MAX_AGENT_WEBSOCKET_MESSAGE_BYTES,
  type MinimalWebSocketConnection,
} from "../../src/remote/websocket.js";

interface RunningServer {
  server: Server;
  port: number;
  connections: MinimalWebSocketConnection[];
}

interface ServerFrame {
  opcode: number;
  payload: Buffer;
}

const servers: Server[] = [];
const clients: WebSocket[] = [];
const rawSockets: Socket[] = [];

async function startServer(): Promise<RunningServer> {
  const connections: MinimalWebSocketConnection[] = [];
  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    acceptWebSocketUpgrade(req, socket, head, (connection) => {
      connections.push(connection);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return { server, port: address.port, connections };
}

async function openClient(port: number): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  clients.push(client);
  await once(client, "open");
  return client;
}

async function waitForConnection(server: RunningServer): Promise<MinimalWebSocketConnection> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const connection = server.connections[0];
    if (connection) {
      return connection;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("WebSocket connection was not accepted");
}

function clientFrame(options: {
  opcode: number;
  body: string | Buffer;
  fin?: boolean;
  masked?: boolean;
}): Buffer {
  const payload = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, "utf8");
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const finBit = options.fin === false ? 0 : 0x80;
  const masked = options.masked !== false;
  const maskBit = masked ? 0x80 : 0;
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([finBit | options.opcode, maskBit | payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = finBit | options.opcode;
    header[1] = maskBit | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = finBit | options.opcode;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  if (!masked) {
    return Buffer.concat([header, payload]);
  }
  const encoded = Buffer.from(payload);
  for (let index = 0; index < encoded.length; index += 1) {
    encoded[index] = (encoded[index] ?? 0) ^ (mask[index % mask.length] ?? 0);
  }
  return Buffer.concat([header, mask, encoded]);
}

function oversizedMaskedHeader(): Buffer {
  const header = Buffer.alloc(14);
  header[0] = 0x81;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(MAX_AGENT_WEBSOCKET_MESSAGE_BYTES + 1), 2);
  header.set([0x11, 0x22, 0x33, 0x44], 10);
  return header;
}

async function openRawWebSocket(port: number): Promise<{ socket: Socket; buffered: Buffer }> {
  const socket = connect(port, "127.0.0.1");
  rawSockets.push(socket);
  await once(socket, "connect");
  socket.write(
    [
      "GET / HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${Buffer.alloc(16, 7).toString("base64")}`,
      "",
      "",
    ].join("\r\n"),
  );
  const response = await readUntil(socket, Buffer.alloc(0), (buffer) =>
    buffer.includes(Buffer.from("\r\n\r\n")),
  );
  const headerEnd = response.indexOf(Buffer.from("\r\n\r\n")) + 4;
  expect(response.subarray(0, headerEnd).toString("utf8")).toContain(
    "HTTP/1.1 101 Switching Protocols",
  );
  return { socket, buffered: response.subarray(headerEnd) };
}

async function readServerFrame(socket: Socket, initial: Buffer): Promise<ServerFrame> {
  const buffer = await readUntil(
    socket,
    initial,
    (candidate) => frameLength(candidate) !== undefined,
  );
  const totalLength = frameLength(buffer);
  if (totalLength === undefined) {
    throw new Error("Incomplete server frame");
  }
  const first = buffer[0] ?? 0;
  const marker = buffer[1] ?? 0;
  let offset = 2;
  let length = marker & 0x7f;
  if (length === 126) {
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  return { opcode: first & 0x0f, payload: buffer.subarray(offset, offset + length) };
}

function frameLength(buffer: Buffer): number | undefined {
  if (buffer.length < 2) {
    return undefined;
  }
  const marker = (buffer[1] ?? 0) & 0x7f;
  let offset = 2;
  let length = marker;
  if (marker === 126) {
    if (buffer.length < 4) {
      return undefined;
    }
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (marker === 127) {
    if (buffer.length < 10) {
      return undefined;
    }
    const longLength = buffer.readBigUInt64BE(2);
    if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Server frame length is not safe");
    }
    length = Number(longLength);
    offset = 10;
  }
  const total = offset + length;
  return buffer.length >= total ? total : undefined;
}

async function readUntil(
  socket: Socket,
  initial: Buffer,
  predicate: (buffer: Buffer) => boolean,
): Promise<Buffer> {
  if (predicate(initial)) {
    return initial;
  }
  return await new Promise<Buffer>((resolve, reject) => {
    let buffer = initial;
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for socket data")), 3000);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (predicate(buffer)) {
        finish();
      }
    };
    const onClose = () => finish(new Error("Socket closed before expected data arrived"));
    const onError = (error: Error) => finish(error);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("close", onClose);
      socket.off("error", onError);
      if (error) {
        reject(error);
      } else {
        resolve(buffer);
      }
    };
    socket.on("data", onData);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function expectProtocolClose(
  port: number,
  frame: Buffer,
  expectedCode: number,
): Promise<void> {
  const { socket, buffered } = await openRawWebSocket(port);
  socket.write(frame);
  const response = await readServerFrame(socket, buffered);
  expect(response.opcode).toBe(0x8);
  expect(response.payload.readUInt16BE(0)).toBe(expectedCode);
  socket.destroy();
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.terminate();
    }
  }
  for (const socket of rawSockets.splice(0)) {
    socket.destroy();
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe.sequential("remote WebSocket protocol", () => {
  test("exchanges text and JSON messages and observes pong/close lifecycle", async () => {
    const running = await startServer();
    const client = await openClient(running.port);
    const connection = await waitForConnection(running);
    const text = new Promise<string>((resolve) => connection.onText(resolve));

    client.send("hello");
    await expect(text).resolves.toBe("hello");

    const serverMessage = once(client, "message");
    connection.sendJson({ ok: true });
    const [data, isBinary] = (await serverMessage) as [Buffer, boolean];
    expect(isBinary).toBe(false);
    expect(JSON.parse(data.toString("utf8"))).toEqual({ ok: true });

    const pong = new Promise<void>((resolve) => connection.onPong(resolve));
    connection.ping();
    await expect(pong).resolves.toBeUndefined();

    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      connection.onClose((code, reason) => resolve({ code, reason })),
    );
    client.close(1000, "done");
    await expect(closed).resolves.toEqual({ code: 1000, reason: "done" });
  });

  test("reassembles fragmented text messages", async () => {
    const running = await startServer();
    const client = await openClient(running.port);
    const connection = await waitForConnection(running);
    const text = new Promise<string>((resolve) => connection.onText(resolve));

    client.send("hel", { fin: false });
    client.send("lo", { fin: true });

    await expect(text).resolves.toBe("hello");
  });

  test("rejects binary application messages with unsupported-data close code", async () => {
    const running = await startServer();
    const client = await openClient(running.port);
    await waitForConnection(running);
    const closed = once(client, "close");

    client.send(Buffer.from([0x01]), { binary: true });

    const [code] = (await closed) as [number, Buffer];
    expect(code).toBe(1003);
  });

  test("fails closed on unmasked, reserved, invalid UTF-8, invalid close, and fragmented control frames", async () => {
    const running = await startServer();

    await expectProtocolClose(
      running.port,
      clientFrame({ opcode: 0x1, body: "unmasked", masked: false }),
      1002,
    );
    await expectProtocolClose(running.port, clientFrame({ opcode: 0x3, body: "reserved" }), 1002);
    await expectProtocolClose(
      running.port,
      clientFrame({ opcode: 0x1, body: Buffer.from([0xc3, 0x28]) }),
      1007,
    );
    const invalidClosePayload = Buffer.alloc(2);
    invalidClosePayload.writeUInt16BE(1005, 0);
    await expectProtocolClose(
      running.port,
      clientFrame({ opcode: 0x8, body: invalidClosePayload }),
      1002,
    );
    await expectProtocolClose(
      running.port,
      clientFrame({ opcode: 0x9, body: "ping", fin: false }),
      1002,
    );
  });

  test("rejects payload lengths above the configured maximum", async () => {
    const running = await startServer();
    await expectProtocolClose(running.port, oversizedMaskedHeader(), 1009);
  });

  test("rejects invalid upgrade requests before accepting a connection", async () => {
    const running = await startServer();
    const socket = connect(running.port, "127.0.0.1");
    rawSockets.push(socket);
    await once(socket, "connect");
    socket.write(
      [
        "GET / HTTP/1.1",
        `Host: 127.0.0.1:${running.port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );

    await expect(
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Invalid upgrade was not closed")), 3000);
        socket.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      }),
    ).resolves.toBeUndefined();
    expect(running.connections).toEqual([]);
  });
});
