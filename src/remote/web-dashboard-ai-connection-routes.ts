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
