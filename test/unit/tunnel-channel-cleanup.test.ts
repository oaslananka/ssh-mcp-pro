import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { trackedChannelCleanup } from "../../src/tunnel-channel-cleanup.js";

class Channel extends EventEmitter {
  readonly failure = new Error("destroy failed");
  attempts = 0;
  constructor(private readonly behavior: "fail" | "close-then-throw" | "close" | "deferred") {
    super();
  }
  destroy(): void {
    this.attempts++;
    if (this.behavior === "close" || this.behavior === "close-then-throw") this.emit("close");
    if (this.behavior === "fail" || this.behavior === "close-then-throw") throw this.failure;
  }
}

describe("SSH tunnel channel cleanup", () => {
  test("keeps failed cleanup owned until close is observed and permits retry", () => {
    const onFailure = vi.fn();
    const tracker = trackedChannelCleanup<Channel>(onFailure);
    const channel = new Channel("fail");
    tracker.destroy(channel);
    expect(() => tracker.assertComplete()).toThrow(channel.failure);
    tracker.destroy(channel);
    expect(channel.attempts).toBe(2);
    expect(channel.listenerCount("close")).toBe(1);
    expect(onFailure).toHaveBeenCalledTimes(2);
    channel.emit("close");
    expect(() => tracker.assertComplete()).not.toThrow();
    tracker.destroy(channel);
    expect(channel.attempts).toBe(2);
  });

  test("does not resurrect an error after synchronous close", () => {
    const onFailure = vi.fn();
    const tracker = trackedChannelCleanup<Channel>(onFailure);
    const channel = new Channel("close-then-throw");
    tracker.destroy(channel);
    expect(() => tracker.assertComplete()).not.toThrow();
    expect(onFailure).not.toHaveBeenCalled();
    tracker.destroy(channel);
    expect(channel.attempts).toBe(1);
  });

  test("retains each failed channel independently", () => {
    const tracker = trackedChannelCleanup<Channel>(vi.fn());
    const first = new Channel("fail");
    const second = new Channel("fail");
    tracker.destroy(first);
    tracker.destroy(second);
    expect(() => tracker.assertComplete()).toThrow(AggregateError);
    try {
      tracker.assertComplete();
    } catch (error) {
      expect((error as AggregateError).errors).toEqual([first.failure, second.failure]);
    }
    first.emit("close");
    expect(() => tracker.assertComplete()).toThrow(second.failure);
    second.emit("close");
    expect(() => tracker.assertComplete()).not.toThrow();
  });

  test("does not register duplicate close listeners on deferred destruction", () => {
    const onFailure = vi.fn();
    const tracker = trackedChannelCleanup<Channel>(onFailure);
    const channel = new Channel("deferred");
    tracker.destroy(channel);
    tracker.destroy(channel);
    expect(channel.listenerCount("close")).toBe(1);
    expect(() => tracker.assertComplete()).not.toThrow();
    channel.emit("close");
    tracker.destroy(channel);
    expect(channel.attempts).toBe(2);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
