import { afterEach, describe, expect, test } from "vitest";
import { AgentEnrollmentService } from "../../src/remote/agent-enrollment.js";
import { hashSecret } from "../../src/remote/crypto.js";
import { RemoteStore } from "../../src/remote/store.js";
import type { AuditEvent, RemoteConfig, RemotePrincipal } from "../../src/remote/types.js";

const stores: RemoteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function fixture() {
  const store = new RemoteStore(":memory:");
  stores.push(store);
  const events: Array<Omit<AuditEvent, "id" | "createdAt">> = [];
  const service = new AgentEnrollmentService(
    {
      publicBaseUrl: "https://example.test",
      enrollmentTokenTtlSeconds: 600,
    } as RemoteConfig,
    store,
    (event) => events.push(event),
  );
  const principal = (userId: string, isAdmin = true): RemotePrincipal =>
    ({
      userId,
      capabilities: isAdmin ? ["agents.admin"] : ["agents.read"],
    }) as RemotePrincipal;
  return { store, events, service, principal };
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("remote agent enrollment service", () => {
  test("denies enrollment without agents.admin, leaving the store unchanged", () => {
    const { service, store, principal, events } = fixture();
    expect(
      captureError(() =>
        service.createEnrollmentToken(principal("alice", false), { alias: "node" }),
      ),
    ).toMatchObject({ code: "INVALID_SCOPE", status: 403 });
    expect(store.listAgents("alice")).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test("enrolls for the requesting user and stores only a token hash", () => {
    const { service, store, principal, events } = fixture();
    const result = service.createEnrollmentToken(principal("alice"), {
      alias: " node-1 ",
      requested_profile: "unknown-profile",
    });
    const token = result.enrollment_token;
    expect(token).toEqual(expect.any(String));
    expect(typeof token).toBe("string");
    const agent = store.getAgentByAlias("alice", "node-1");
    expect(agent).toMatchObject({
      alias: "node-1",
      userId: "alice",
      status: "pending",
      profile: "read-only",
    });
    expect(store.listAgents("bob")).toEqual([]);
    expect(store.getEnrollmentTokenByHash(hashSecret(String(token)))).toMatchObject({
      agentId: agent?.id,
      userId: "alice",
    });
    expect(result).toMatchObject({
      agent_id: agent?.id,
      alias: "node-1",
      token_recoverable: true,
      expires_in_seconds: 600,
    });
    expect(JSON.stringify(events)).not.toContain(String(token));
    expect(events).toMatchObject([
      {
        userId: "alice",
        agentId: agent?.id,
        eventType: "enrollment_token_created",
        severity: "info",
      },
    ]);
  });

  test("prevents duplicate live aliases per user without blocking other users", () => {
    const { service, store, principal } = fixture();
    service.createEnrollmentToken(principal("alice"), { alias: "shared-name" });
    expect(
      captureError(() =>
        service.createEnrollmentToken(principal("alice"), { alias: "shared-name" }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    service.createEnrollmentToken(principal("bob"), { alias: "shared-name" });
    expect(store.listAgents("alice")).toHaveLength(1);
    expect(store.listAgents("bob")).toHaveLength(1);
  });

  test("allows retrying the same alias after an unused enrollment token has expired", () => {
    const { service, store, principal } = fixture();
    const first = service.createEnrollmentToken(principal("alice"), { alias: "linux-laptop" });
    const firstToken = store.getEnrollmentTokenByHash(hashSecret(String(first.enrollment_token)));
    expect(firstToken).toBeDefined();
    store.pruneExpiredTransientRecords(firstToken!.expiresAt);

    expect(store.getAgentByAlias("alice", "linux-laptop")).toBeUndefined();
    const second = service.createEnrollmentToken(principal("alice"), { alias: "linux-laptop" });
    expect(second.agent_id).not.toBe(first.agent_id);
    expect(store.listAgents("alice")).toHaveLength(1);
  });

  test("quotes apostrophes in install commands and does not claim old tokens are recoverable", () => {
    const { service, store, principal } = fixture();
    const result = service.createEnrollmentToken(principal("alice"), {
      alias: "host's terminal",
      requested_profile: "operations",
    });
    const agent = store.getAgentByAlias("alice", "host's terminal");
    expect(agent?.profile).toBe("operations");
    const issued = result.commands as Record<string, string>;
    expect(issued.npm).toContain("host'\"'\"'s terminal");
    expect(issued.windows).toContain("'host''s terminal'");
    expect(issued.run).toContain("ssh-mcp-pro-agent run");

    const existing = service.installCommand(agent!, undefined);
    const commands = existing.commands as Record<string, string>;
    expect(existing.token_recoverable).toBe(false);
    expect(existing.expires_in_seconds).toBeUndefined();
    expect(existing).not.toHaveProperty("enrollment_token");
    expect(commands.npm).toContain("<create-a-new-enrollment-token>");
    expect(commands.windows).toContain("<create-a-new-enrollment-token>");
    expect(store.listAgents("alice")).toHaveLength(1);
  });
});
