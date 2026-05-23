import { redactErrorMessage, redactSensitiveData } from "./logging.js";
import type { PolicyDecision } from "./policy.js";

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  sessionId?: string;
  host?: string;
  username?: string;
  target?: string;
  allowed: boolean;
  mode?: string;
  reason?: string;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];
  private sequence = 0;

  constructor(private readonly maxEvents = 500) {}

  private redactEvent(event: AuditEvent): AuditEvent {
    const fieldRedacted = redactSensitiveData(event);
    return this.redactStringPatterns(fieldRedacted) as AuditEvent;
  }

  private redactStringPatterns(value: unknown): unknown {
    if (typeof value === "string") {
      return redactErrorMessage(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactStringPatterns(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.redactStringPatterns(item)]),
      );
    }

    return value;
  }

  record(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
    const auditEvent: AuditEvent = {
      ...event,
      id: `audit-${Date.now()}-${++this.sequence}`,
      timestamp: new Date().toISOString(),
    };
    const redactedEvent = this.redactEvent(auditEvent);

    this.events.push(redactedEvent);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    return { ...redactedEvent };
  }

  recordPolicyDecision(
    decision: PolicyDecision,
    details: Omit<AuditEvent, "id" | "timestamp" | "allowed" | "mode" | "reason">,
  ): AuditEvent {
    return this.record({
      ...details,
      allowed: decision.allowed,
      mode: decision.mode,
      ...(decision.reason ? { reason: decision.reason } : {}),
    });
  }

  list(limit = 100): AuditEvent[] {
    return this.events.slice(-limit).map((event) => ({ ...event }));
  }
}
