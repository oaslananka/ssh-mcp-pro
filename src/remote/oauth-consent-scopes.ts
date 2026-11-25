import { safeError, scopeList } from "./http-util.js";
import { REVIEWER_DEMO_SCOPES } from "./types.js";

/** Minimal inspection grant available even when an AI client requests elevated scopes. */
const READ_ONLY_CONSENT_SCOPES = REVIEWER_DEMO_SCOPES;

/** A consent choice must never add scopes not requested by the client. */
export function readOnlyConsentScope(requested: string): string | undefined {
  const requestedScopes = scopeList(requested);
  const readScopes = READ_ONLY_CONSENT_SCOPES.filter((entry) => requestedScopes.includes(entry));
  return readScopes.length > 0 && readScopes.length < requestedScopes.length
    ? readScopes.join(" ")
    : undefined;
}

export function reviewerConsentScope(requested: string): string | undefined {
  const requestedScopes = scopeList(requested);
  const reviewerScopes = REVIEWER_DEMO_SCOPES.filter((entry) => requestedScopes.includes(entry));
  return reviewerScopes.length > 0 ? reviewerScopes.join(" ") : undefined;
}

export function resolveConsentScope(requested: string, mode: string | undefined): string {
  const grantMode = mode ?? (readOnlyConsentScope(requested) ? "read_only" : "requested");
  if (grantMode === "read_only") {
    const narrowed = readOnlyConsentScope(requested);
    if (!narrowed) {
      throw safeError("INVALID_SCOPE", "Read-only consent is not available", 400);
    }
    return narrowed;
  } else if (grantMode !== "requested") {
    throw safeError("INVALID_SCOPE", "Invalid access level", 400);
  }
  return requested;
}
