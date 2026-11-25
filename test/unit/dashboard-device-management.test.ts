import { Script, createContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { DASHBOARD_DEVICE_MANAGEMENT_SCRIPT } from "../../src/remote/web-dashboard-device-management-script.js";

const sample = { id: "agt_sample", alias: "Test workstation", status: "offline" };
const response = (body: unknown, status = 200) => Response.json(body, { status });
function fixture() {
  const dialog = { showModal: vi.fn(), close: vi.fn() };
  const button = () => ({ disabled: false, textContent: "", hidden: false, focus: vi.fn() });
  const elements = {
    deviceActionDialog: dialog,
    deviceActionTitle: button(),
    deviceActionDescription: button(),
    deviceActionFeedback: button(),
    deviceActionConfirm: button(),
    deviceActionCancel: button(),
    deviceNotice: button(),
  };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const context = createContext({
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    console: { error: vi.fn() },
    devicesList: [sample],
    devicesLoaded: true,
    devicesError: "",
    deviceNotice: "",
    deviceLoadGeneration: 0,
    activeTab: "devices",
    renderApp: vi.fn(),
    fetch,
  });
  new Script(DASHBOARD_DEVICE_MANAGEMENT_SCRIPT).runInContext(context);
  return {
    fetch,
    context,
    elements,
    run: <T = unknown>(source: string): T => new Script(source).runInContext(context) as T,
  };
}

describe("device management browser workflow", () => {
  test("cancels without mutation and confirms exact deletion with a fresh list", async () => {
    const f = fixture();
    f.run("removeDevice('agt_sample')");
    expect(f.elements.deviceActionTitle.textContent).toBe("Remove Test workstation?");
    expect(f.elements.deviceActionDescription.textContent).toContain(
      "Files on the computer are not deleted",
    );
    f.run("cancelDeviceAction()");
    expect(f.fetch).not.toHaveBeenCalled();
    f.run("removeDevice('agt_sample')");
    f.fetch.mockResolvedValueOnce(response({ removed: true, agent_id: sample.id }));
    f.fetch.mockResolvedValueOnce(response({ devices: [] }));
    await f.run<Promise<void>>("confirmDeviceAction()");
    expect(f.fetch).toHaveBeenNthCalledWith(1, "/api/dashboard/devices/agt_sample", {
      method: "DELETE",
      headers: { "X-SSH-MCP-Dashboard": "1" },
    });
    expect(f.context.devicesList).toEqual([]);
    expect(f.context.deviceNotice).toBe("Test workstation was removed.");
    expect(f.elements.deviceActionDialog.close).toHaveBeenCalledTimes(2);
    expect(f.elements.deviceNotice.focus).toHaveBeenCalledOnce();
  });

  test("does not accept a false success, retains an actionable error and allows retry", async () => {
    const f = fixture();
    f.run("removeDevice('agt_sample')");
    f.fetch.mockResolvedValueOnce(response({ removed: true, agent_id: "wrong" }));
    f.fetch.mockResolvedValueOnce(response({ devices: [sample] }));
    await f.run<Promise<void>>("confirmDeviceAction()");
    expect(f.context.deviceNotice).toBe("");
    expect(f.elements.deviceActionFeedback.hidden).toBe(false);
    expect(f.elements.deviceActionFeedback.textContent).toContain("did not confirm");
    expect(f.elements.deviceActionConfirm.disabled).toBe(false);
    expect(f.elements.deviceActionDialog.close).not.toHaveBeenCalled();
    f.fetch.mockResolvedValueOnce(response({ removed: true, agent_id: sample.id }));
    f.fetch.mockResolvedValueOnce(response({ devices: [] }));
    await f.run<Promise<void>>("confirmDeviceAction()");
    expect(f.context.devicesList).toEqual([]);
  });

  test("checks inventory when a removal response is lost, without issuing another deletion", async () => {
    const f = fixture();
    f.run("removeDevice('agt_sample')");
    f.fetch.mockRejectedValueOnce(new Error("Connection lost"));
    f.fetch.mockResolvedValueOnce(response({ devices: [] }));
    await f.run<Promise<void>>("confirmDeviceAction()");
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.context.deviceNotice).toBe("Test workstation is no longer in your device list.");
    expect(f.elements.deviceActionDialog.close).toHaveBeenCalledOnce();
  });

  test("ignores out-of-order inventory responses and does not interpret malformed data as empty", async () => {
    const f = fixture();
    let finish!: (value: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = f.run<Promise<boolean>>("loadDevices()");
    f.fetch.mockResolvedValueOnce(response({ devices: [] }));
    await f.run<Promise<boolean>>("loadDevices()");
    finish(response({ devices: [sample] }));
    expect(await old).toBe(false);
    expect(f.context.devicesList).toEqual([]);
    f.fetch.mockResolvedValueOnce(response({ error: "missing list" }));
    expect(await f.run<Promise<boolean>>("loadDevices()")).toBe(false);
    expect(f.context.devicesError).toBe("unavailable");
  });

  test("locks duplicate confirmation while a request is pending", async () => {
    const f = fixture();
    f.run("removeDevice('agt_sample')");
    let finish!: (value: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.run<Promise<void>>("confirmDeviceAction()");
    expect(f.elements.deviceActionConfirm.disabled).toBe(true);
    await f.run<Promise<void>>("confirmDeviceAction()");
    f.run("cancelDeviceAction()");
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.elements.deviceActionDialog.close).not.toHaveBeenCalled();
    f.fetch.mockResolvedValueOnce(response({ devices: [] }));
    finish(response({ removed: true, agent_id: sample.id }));
    await pending;
    expect(f.context.devicesList).toEqual([]);
  });
});
