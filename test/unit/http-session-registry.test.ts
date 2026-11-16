import { describe, expect, it, vi } from "vitest";
import { HttpSessionRegistry, type HttpSessionRecord } from "../../src/http-session-registry.js";

interface TestHttpSession extends HttpSessionRecord {
  label: string;
}

describe("HttpSessionRegistry", () => {
  it("evicts the oldest idle session when capacity is full", () => {
    const closed: Array<{ sessionId: string; reason: string }> = [];
    const registry = new HttpSessionRegistry<TestHttpSession>({
      maxSessions: 2,
      sessionIdleTtlMs: 60_000,
      now: () => 10_000,
      onClose: (sessionId, _session, reason) => closed.push({ sessionId, reason }),
    });

    registry.set("newer", { label: "newer", lastSeenAt: 9_000 });
    registry.set("oldest", { label: "oldest", lastSeenAt: 1_000 });

    const result = registry.reserveCapacity();

    expect(result).toEqual({
      allowed: true,
      evictedSessionId: "oldest",
      reason: "capacity-evict-oldest",
    });
    expect(registry.get("oldest")).toBeUndefined();
    expect(registry.get("newer")?.label).toBe("newer");
    expect(closed).toEqual([{ sessionId: "oldest", reason: "capacity-evict-oldest" }]);
  });

  it("cleans up expired sessions before evicting active sessions", () => {
    const closed: Array<{ sessionId: string; reason: string }> = [];
    const registry = new HttpSessionRegistry<TestHttpSession>({
      maxSessions: 2,
      sessionIdleTtlMs: 1_000,
      now: () => 10_000,
      onClose: (sessionId, _session, reason) => closed.push({ sessionId, reason }),
    });

    registry.set("expired", { label: "expired", lastSeenAt: 8_000 });
    registry.set("active", { label: "active", lastSeenAt: 9_500 });

    expect(registry.reserveCapacity()).toEqual({ allowed: true });
    expect(registry.get("expired")).toBeUndefined();
    expect(registry.get("active")?.label).toBe("active");
    expect(closed).toEqual([{ sessionId: "expired", reason: "idle-timeout" }]);
  });

  it("touches active sessions when read and closes expired sessions", () => {
    let now = 5_000;
    const closed = vi.fn();
    const registry = new HttpSessionRegistry<TestHttpSession>({
      maxSessions: 2,
      sessionIdleTtlMs: 1_000,
      now: () => now,
      onClose: closed,
    });

    registry.set("active", { label: "active", lastSeenAt: 4_500 });
    registry.set("expired", { label: "expired", lastSeenAt: 3_000 });

    expect(registry.getActive("active")?.lastSeenAt).toBe(5_000);
    now = 5_500;

    expect(registry.getActive("expired")).toBeUndefined();
    expect(closed).toHaveBeenCalledWith(
      "expired",
      { label: "expired", lastSeenAt: 3_000 },
      "idle-timeout",
    );
  });

  it("reports capacity-full only when no session can be evicted", () => {
    const registry = new HttpSessionRegistry<TestHttpSession>({
      maxSessions: 0,
      sessionIdleTtlMs: 60_000,
      now: () => 1_000,
    });

    expect(registry.reserveCapacity()).toEqual({ allowed: false, reason: "capacity-full" });
  });

  it("tracks in-flight reservations to prevent concurrent oversubscription", () => {
    const registry = new HttpSessionRegistry<TestHttpSession>({
      maxSessions: 2,
      sessionIdleTtlMs: 60_000,
      now: () => 1_000,
    });

    expect(registry.reserveCapacity()).toEqual({ allowed: true });
    expect(registry.inFlightCount).toBe(1);
    expect(registry.reserveCapacity()).toEqual({ allowed: true });
    expect(registry.inFlightCount).toBe(2);
    // Capacity full due to in-flight reservations
    expect(registry.reserveCapacity()).toEqual({ allowed: false, reason: "capacity-full" });

    // Setting a session completes reservation
    registry.set("s1", { label: "s1", lastSeenAt: 1_000 });
    expect(registry.inFlightCount).toBe(1);
    expect(registry.size).toBe(1);

    // Releasing a failed reservation frees a slot
    registry.releaseReservation();
    expect(registry.inFlightCount).toBe(0);
    expect(registry.reserveCapacity()).toEqual({ allowed: true });
  });
});
