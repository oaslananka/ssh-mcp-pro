interface RuntimeWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event?: { code?: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

type RuntimeWebSocketConstructor = new (url: string) => RuntimeWebSocket;

export function runtimeWebSocket(): RuntimeWebSocketConstructor {
  const candidate = (globalThis as unknown as { WebSocket?: RuntimeWebSocketConstructor })
    .WebSocket;
  if (!candidate) {
    throw new Error("This Node.js runtime does not expose WebSocket. Use Node 22.22+ or Node 24.");
  }
  return candidate;
}

/**
 * An enrollment response cannot redirect the signed agent hello or action
 * results to a different origin or downgrade a secure transport. The
 * connection path remains configurable on the server.
 */
export function validateAgentWebSocketDestination(
  serverAddress: string,
  destination: string,
): string {
  let server: URL;
  let websocket: URL;
  try {
    server = new URL(serverAddress);
    websocket = new URL(destination);
  } catch {
    throw new Error("Agent WebSocket destination does not match enrolled server");
  }
  const requiredProtocol = server.protocol === "https:" ? "wss:" : "ws:";
  if (
    (server.protocol !== "https:" && server.protocol !== "http:") ||
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    websocket.protocol !== requiredProtocol ||
    websocket.host !== server.host ||
    websocket.username ||
    websocket.password ||
    websocket.search ||
    websocket.hash
  ) {
    throw new Error("Agent WebSocket destination does not match enrolled server");
  }
  return websocket.href;
}
