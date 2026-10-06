export interface HttpSessionRecord {
  lastSeenAt: number;
}

export interface HttpSessionRegistryOptions<TSession extends HttpSessionRecord> {
  maxSessions: number;
  sessionIdleTtlMs: number;
  now?: () => number;
  onClose?: (sessionId: string, session: TSession, reason: string) => void;
}

export interface HttpSessionCapacityResult {
  allowed: boolean;
  evictedSessionId?: string;
  reason?: "capacity-evict-oldest" | "capacity-full";
}

export class HttpSessionRegistry<TSession extends HttpSessionRecord> {
  private readonly sessions = new Map<string, TSession>();
  private readonly maxSessions: number;
  private readonly sessionIdleTtlMs: number;
  private readonly now: () => number;
  private readonly onClose:
    ((sessionId: string, session: TSession, reason: string) => void) | undefined;

  constructor(options: HttpSessionRegistryOptions<TSession>) {
    this.maxSessions = options.maxSessions;
    this.sessionIdleTtlMs = options.sessionIdleTtlMs;
    this.now = options.now ?? Date.now;
    this.onClose = options.onClose;
  }

  get size(): number {
    return this.sessions.size;
  }

  set(sessionId: string, session: TSession): void {
    this.sessions.set(sessionId, session);
  }

  get(sessionId: string | undefined): TSession | undefined {
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  entries(): IterableIterator<[string, TSession]> {
    return this.sessions.entries();
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }

  isExpired(session: TSession, now = this.now()): boolean {
    return now - session.lastSeenAt > this.sessionIdleTtlMs;
  }

  close(sessionId: string, reason: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);
    this.onClose?.(sessionId, session, reason);
    return true;
  }

  getActive(sessionId: string | undefined): TSession | undefined {
    const session = this.get(sessionId);
    if (!session) {
      return undefined;
    }

    if (this.isExpired(session)) {
      this.close(sessionId as string, "idle-timeout");
      return undefined;
    }

    session.lastSeenAt = this.now();
    return session;
  }

  cleanupExpired(): number {
    let closed = 0;
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (this.isExpired(session, now)) {
        this.close(sessionId, "idle-timeout");
        closed += 1;
      }
    }
    return closed;
  }

  evictOldest(reason = "capacity-evict-oldest"): string | undefined {
    let oldestSessionId: string | undefined;
    let oldestLastSeenAt = Number.POSITIVE_INFINITY;

    for (const [sessionId, session] of this.sessions) {
      if (session.lastSeenAt < oldestLastSeenAt) {
        oldestSessionId = sessionId;
        oldestLastSeenAt = session.lastSeenAt;
      }
    }

    if (!oldestSessionId) {
      return undefined;
    }

    this.close(oldestSessionId, reason);
    return oldestSessionId;
  }

  reserveCapacity(): HttpSessionCapacityResult {
    this.cleanupExpired();
    if (this.sessions.size < this.maxSessions) {
      return { allowed: true };
    }

    const evictedSessionId = this.evictOldest("capacity-evict-oldest");
    if (evictedSessionId) {
      return { allowed: true, evictedSessionId, reason: "capacity-evict-oldest" };
    }

    return { allowed: false, reason: "capacity-full" };
  }
}
