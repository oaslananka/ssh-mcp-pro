import { afterEach, describe, expect, test, vi } from "vitest";
import {
  runtimeWebSocket,
  validateAgentWebSocketDestination,
} from "../../src/remote/agent-websocket-transport.js";

describe("agent WebSocket transport boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserves secure same-origin destinations and configurable paths", () => {
    expect(
      validateAgentWebSocketDestination(
        "https://agent.example.test:443/base",
        "wss://agent.example.test/custom",
      ),
    ).toBe("wss://agent.example.test/custom");
    expect(
      validateAgentWebSocketDestination("http://127.0.0.1:3000", "ws://127.0.0.1:3000/socket"),
    ).toBe("ws://127.0.0.1:3000/socket");
  });

  test.each([
    ["https://agent.example.test", "ws://agent.example.test/socket"],
    ["http://agent.example.test", "wss://agent.example.test/socket"],
    ["https://agent.example.test", "wss://other.example.test/socket"],
    ["https://agent.example.test:8443", "wss://agent.example.test/socket"],
    ["https://user:password@agent.example.test", "wss://agent.example.test/socket"],
    ["https://agent.example.test?query=1", "wss://agent.example.test/socket"],
    ["https://agent.example.test#fragment", "wss://agent.example.test/socket"],
    ["https://agent.example.test", "wss://user:password@agent.example.test/socket"],
    ["https://agent.example.test", "wss://agent.example.test/socket?query=1"],
    ["https://agent.example.test", "wss://agent.example.test/socket#fragment"],
    ["ftp://agent.example.test", "ws://agent.example.test/socket"],
    ["invalid", "wss://agent.example.test/socket"],
    ["https://agent.example.test", "/socket"],
  ])("rejects mismatched or invalid destination %s -> %s", (server, destination) => {
    expect(() => validateAgentWebSocketDestination(server, destination)).toThrow(
      "Agent WebSocket destination does not match enrolled server",
    );
  });

  test("uses the runtime WebSocket constructor", () => {
    expect(runtimeWebSocket()).toBe(globalThis.WebSocket);
  });

  test("reports unavailable WebSocket without attempting a connection", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => runtimeWebSocket()).toThrow("This Node.js runtime does not expose WebSocket");
  });
});
