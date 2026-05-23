import {
  REMOTE_SCOPES,
  SCOPE_CAPABILITY_MAP,
  type RemoteCapability,
  type RemoteScope,
} from "./types.js";

export function parseScopes(scope: string | undefined): RemoteScope[] {
  if (!scope) {
    return [];
  }
  const requested = scope.split(/\s+/u).filter(Boolean);
  return requested.filter((item): item is RemoteScope =>
    REMOTE_SCOPES.includes(item as RemoteScope),
  );
}

export function capabilitiesFromScopes(scopes: RemoteScope[]): RemoteCapability[] {
  const capabilities = new Set<RemoteCapability>();
  for (const scope of scopes) {
    for (const capability of SCOPE_CAPABILITY_MAP[scope]) {
      capabilities.add(capability);
    }
  }
  return [...capabilities];
}

export function hasCapability(
  capabilities: readonly RemoteCapability[],
  capability: RemoteCapability,
): boolean {
  return capabilities.includes(capability);
}

export function allRemoteScopes(): RemoteScope[] {
  return [...REMOTE_SCOPES];
}
