import { Script, createContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { DASHBOARD_AI_CLIENT_SCRIPT } from "../../src/remote/web-dashboard-ai-client-script.js";
import { DASHBOARD_AI_REMOVAL_SCRIPT } from "../../src/remote/web-dashboard-ai-removal-script.js";
const active = {
  id: "con_active",
  clientName: "Connected AI",
  status: "active",
  deviceIds: ["agt_fixture"],
  redirectHosts: ["example.test"],
};
const revoked = {
  id: "con_revoked",
  clientName: "Old <AI>",
  status: "revoked",
  deviceIds: [],
  redirectHosts: ["long.example.test", "another.example.test"],
};
const inventory = (connections: unknown[]) =>
  Response.json({ clients: [], connections, strictVisibility: true });
function fixture() {
  const button = () => ({ textContent: "", hidden: false, disabled: false, focus: vi.fn() });
  const elements = {
    aiRemoveDialog: { showModal: vi.fn(), close: vi.fn() },
    aiRemoveTitle: button(),
    aiRemoveFeedback: button(),
    aiRemoveConfirm: button(),
    aiRemoveCancel: button(),
    aiClientNotice: button(),
    tabContent: { innerHTML: "" },
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const context = createContext({
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    console: { error: vi.fn() },
    currentUser: { provider: "github" },
    aiClientsList: [],
    aiConnectionsList: [revoked, active],
    aiClientsLoaded: true,
    aiClientsError: "",
    aiHistoryOpen: false,
    aiLoadGeneration: 0,
    aiClientNotice: "",
    strictVisibilityEnabled: true,
    activeTab: "ai-clients",
    devicesError: "",
    devicesList: [
      { id: "agt_fixture", alias: "Fixture PC", isLiveConnected: true, profile: "read-only" },
    ],
    loadDevices: vi.fn().mockResolvedValue(true),
    escapeHtml: (text: string) =>
      String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;"),
    fetch,
  });
  new Script(DASHBOARD_AI_CLIENT_SCRIPT + DASHBOARD_AI_REMOVAL_SCRIPT).runInContext(context);
  return {
    fetch,
    context,
    elements,
    run: <T = unknown>(source: string): T => new Script(source).runInContext(context) as T,
  };
}

describe("AI connection removal in the dashboard", () => {
  test("shows active permissions once, with compact collapsed disconnected history and escaped labels", () => {
    const f = fixture();
    const page = f.run<string>("renderAiConnectionCards()");
    expect(page).toContain('aria-label="Active AI connections"');
    expect(page).toContain('id="aiConnectionHistory" ontoggle=');
    expect(page).toContain("Disconnected connections (1)");
    expect(page).toContain("Old &lt;AI&gt;");
    expect(page).toContain("Redirect hosts (2)");
    expect(page.split('type="checkbox"')).toHaveLength(2);
    expect(page.split("Fixture PC")).toHaveLength(2);
    expect(page).toContain('data-connection-id="con_revoked"');
    expect(page).not.toContain('data-connection-id="con_active"');
    f.run("openAiRemoveDialog('con_active')");
    expect(f.elements.aiRemoveDialog.showModal).not.toHaveBeenCalled();
  });

  test("cancels safely and removes the exact revoked connection after a confirmed response", async () => {
    const f = fixture();
    f.run("openAiRemoveDialog('con_revoked')");
    expect(f.elements.aiRemoveTitle.textContent).toBe("Remove Old <AI>?");
    f.run("cancelAiRemove()");
    expect(f.fetch).not.toHaveBeenCalled();
    f.run("openAiRemoveDialog('con_revoked')");
    f.fetch.mockResolvedValueOnce(Response.json({ removed: true, connectionId: revoked.id }));
    f.fetch.mockResolvedValueOnce(inventory([active]));
    await f.run<Promise<void>>("confirmAiRemove()");
    expect(f.fetch).toHaveBeenNthCalledWith(1, "/api/dashboard/ai-connections/con_revoked", {
      method: "DELETE",
      headers: { "X-SSH-MCP-Dashboard": "1" },
    });
    expect(f.context.aiConnectionsList).toEqual([active]);
    expect(f.context.aiClientNotice).toContain("connection removed");
    expect(f.elements.tabContent.innerHTML).not.toContain("Disconnected connections");
  });

  test("reports an unconfirmed removal, keeps the modal usable and supports retry", async () => {
    const f = fixture();
    f.run("openAiRemoveDialog('con_revoked')");
    f.fetch.mockResolvedValueOnce(Response.json({ removed: true, connectionId: active.id }));
    f.fetch.mockResolvedValueOnce(inventory([revoked, active]));
    await f.run<Promise<void>>("confirmAiRemove()");
    expect(f.elements.aiRemoveFeedback.hidden).toBe(false);
    expect(f.elements.aiRemoveFeedback.textContent).toContain("did not confirm removal");
    expect(f.elements.aiRemoveDialog.close).not.toHaveBeenCalled();
    expect(f.elements.aiRemoveConfirm.disabled).toBe(false);
    f.fetch.mockResolvedValueOnce(Response.json({ removed: true, connectionId: revoked.id }));
    f.fetch.mockResolvedValueOnce(inventory([active]));
    await f.run<Promise<void>>("confirmAiRemove()");
    expect(f.context.aiConnectionsList).toEqual([active]);
  });

  test("reconciles a lost response instead of repeating the mutation", async () => {
    const f = fixture();
    f.run("openAiRemoveDialog('con_revoked')");
    f.fetch.mockRejectedValueOnce(new Error("network error"));
    f.fetch.mockResolvedValueOnce(inventory([active]));
    await f.run<Promise<void>>("confirmAiRemove()");
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.context.aiClientNotice).toContain("no longer in your connection list");
    expect(f.elements.aiRemoveDialog.close).toHaveBeenCalledOnce();
  });

  test("rejects stale inventory and locks duplicate confirmations", async () => {
    const f = fixture();
    let finish!: (response: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stale = f.run<Promise<boolean>>("loadAiClients()");
    f.run("openAiRemoveDialog('con_revoked')");
    let confirm!: (response: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = f.run<Promise<void>>("confirmAiRemove()");
    await f.run<Promise<void>>("confirmAiRemove()");
    f.run("cancelAiRemove()");
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.elements.aiRemoveConfirm.disabled).toBe(true);
    f.fetch.mockResolvedValueOnce(inventory([active]));
    confirm(Response.json({ removed: true, connectionId: revoked.id }));
    await pending;
    finish(inventory([revoked, active]));
    expect(await stale).toBe(false);
    expect(f.context.aiConnectionsList).toEqual([active]);
  });
});
