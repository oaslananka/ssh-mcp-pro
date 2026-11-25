/** A failed destroy is not cleared until the channel actually emits close. */
export function trackedChannelCleanup<
  T extends { destroy(): unknown; once(event: "close", callback: () => void): unknown },
>(onFailure: (error: unknown) => void) {
  const failures = new Map<T, unknown>();
  const observed = new WeakSet<T>();
  const closed = new WeakSet<T>();
  return {
    destroy(channel: T): void {
      if (closed.has(channel)) return;
      if (!observed.has(channel)) {
        observed.add(channel);
        channel.once("close", () => {
          closed.add(channel);
          failures.delete(channel);
        });
      }
      try {
        channel.destroy();
      } catch (error) {
        // A synchronous close event is stronger evidence than a subsequent
        // exception from destroy(): do not resurrect an already-cleared error.
        if (!closed.has(channel)) {
          failures.set(channel, error);
          onFailure(error);
        }
      }
    },
    assertComplete(): void {
      const errors = [...failures.values()];
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "SSH channel destruction remains incomplete");
      }
    },
  };
}
