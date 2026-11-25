import type { ServerResponse } from "node:http";
import { addNoStore } from "./http-util.js";
import type { RemoteStore } from "./store.js";
import type { AuditEvent, RemotePrincipal } from "./types.js";
import { jsonResponse } from "./util.js";

/** The dashboard router validates browser mutation headers before calling this handler. */
export function handleAiConnectionMutation(
  deps: { store: RemoteStore; audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void },
  principal: RemotePrincipal | undefined,
  res: ServerResponse,
  pathname: string,
  operation: "disconnect" | "remove",
): void {
  if (!principal) {
    jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
    return;
  }
  const connectionId = pathname.slice(
    "/api/dashboard/ai-connections/".length,
    operation === "disconnect" ? -"/disconnect".length : undefined,
  );
  if (
    !/^con_[a-f0-9]{32}$/.test(connectionId) ||
    !deps.store.getOAuthConnection(principal.userId, connectionId)
  ) {
    jsonResponse(res, 404, { error: "AI connection not found" }, addNoStore());
    return;
  }
  if (operation === "remove") {
    if (!deps.store.removeRevokedOAuthConnection(principal.userId, connectionId)) {
      jsonResponse(res, 409, { error: "Disconnect this AI before removing it" }, addNoStore());
      return;
    }
    deps.audit({
      userId: principal.userId,
      eventType: "ai_connection_removed",
      severity: "info",
      metadata: { connection_id: connectionId },
    });
    jsonResponse(res, 200, { removed: true, connectionId }, addNoStore());
    return;
  }
  const revoked = deps.store.revokeOAuthConnection(
    principal.userId,
    connectionId,
    new Date().toISOString(),
  );
  if (revoked) {
    deps.audit({
      userId: principal.userId,
      eventType: "ai_connection_disconnected",
      severity: "warn",
      metadata: { connection_id: connectionId },
    });
  }
  jsonResponse(res, 200, { disconnected: true }, addNoStore());
}

/** Manage account-scoped OAuth grant history without modifying global registrations. */
export function handleAiClientMutation(
  deps: { store: RemoteStore; audit: (event: Omit<AuditEvent, "id" | "createdAt">) => void },
  principal: RemotePrincipal | undefined,
  res: ServerResponse,
  pathname: string,
  operation: "remove" | "revoke",
): void {
  if (!principal) {
    jsonResponse(res, 401, { error: "Authentication required" }, addNoStore());
    return;
  }
  const clientId = pathname.slice(
    "/api/dashboard/ai-clients/".length,
    operation === "revoke" ? -"/revoke".length : undefined,
  );
  if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(clientId)) {
    jsonResponse(res, 404, { error: "AI client not found" }, addNoStore());
    return;
  }
  const now = new Date().toISOString();
  if (operation === "remove") {
    const outcome = deps.store.removeUserOAuthClientHistory(principal.userId, clientId, now);
    if (outcome === "missing") {
      jsonResponse(res, 404, { error: "AI client not found" }, addNoStore());
      return;
    }
    if (outcome === "active") {
      jsonResponse(
        res,
        409,
        { error: "Revoke or disconnect active access before removing OAuth history" },
        addNoStore(),
      );
      return;
    }
    deps.audit({
      userId: principal.userId,
      eventType: "oauth_client_history_removed",
      severity: "info",
      metadata: { client_id: clientId },
    });
    jsonResponse(res, 200, { removed: true, clientId }, addNoStore());
    return;
  }
  const revoked = deps.store.revokeUserOAuthClientGrants(principal.userId, clientId, now);
  if (revoked === undefined) {
    jsonResponse(res, 404, { error: "AI client not found" }, addNoStore());
    return;
  }
  if (revoked > 0) {
    deps.audit({
      userId: principal.userId,
      eventType: "oauth_client_grants_revoked",
      severity: "warn",
      metadata: { client_id: clientId, revoked_refresh_tokens: revoked },
    });
  }
  jsonResponse(res, 200, { revokedRefreshTokens: revoked }, addNoStore());
}
