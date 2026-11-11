import { createContext, runInContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { renderDashboardHtml } from "../../src/remote/web-dashboard-html.js";

interface Device {
  id: string;
  isLiveConnected: boolean;
  status: string;
}
interface TestElement {
  textContent: string;
  innerHTML: string;
  value: string;
  disabled: boolean;
  hidden: boolean;
  style: { display: string };
  focus: () => void;
}

function browserHarness() {
  const nodes = new Map<string, TestElement>();
  const intervals = new Map<number, () => void>();
  const data: { devices: Device[]; error: string | null; polls: number; creates: number } = {
    devices: [],
    error: null,
    polls: 0,
    creates: 0,
  };
  let nextTimerId = 1;
  const node = (id: string): TestElement => {
    let item = nodes.get(id);
    if (!item) {
      item = {
        textContent: "",
        innerHTML: "",
        value: id === "enrollAlias" ? "my-new-device" : id === "enrollProfile" ? "read-only" : "",
        disabled: false,
        hidden: true,
        style: { display: "none" },
        focus() {},
      };
      nodes.set(id, item);
    }
    return item;
  };
  const html = renderDashboardHtml(
    Buffer.from(
      JSON.stringify({ id: "owner-1", displayName: "Owner", provider: "github" }),
    ).toString("base64"),
    JSON.stringify("https://example.test/mcp"),
    JSON.stringify("https://example.test"),
  );
  const openingScript = "<script>";
  const start = html.indexOf(openingScript);
  const end = html.indexOf("</script>", start + openingScript.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const script = html.slice(start + openingScript.length, end);
  const context = createContext({
    atob: (value: string) => Buffer.from(value, "base64").toString("utf8"),
    document: {
      getElementById: node,
      querySelector: () => ({ focus() {} }),
    },
    setInterval(callback: () => void, duration: number) {
      expect(duration).toBeGreaterThanOrEqual(1_000);
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id: number) {
      intervals.delete(id);
    },
    fetch: async (url: string) => {
      if (url === "/api/dashboard/devices/enroll") {
        data.creates += 1;
        if (data.error)
          return { ok: false, status: 409, json: async () => ({ error: data.error }) };
        return {
          ok: true,
          status: 201,
          json: async () => ({
            agent_id: "agent-new",
            commands: { linux: "linux command", windows: "windows command", npm: "npm command" },
          }),
        };
      }
      if (url === "/api/dashboard/devices") {
        data.polls += 1;
        return { ok: true, status: 200, json: async () => ({ devices: data.devices }) };
      }
      throw new Error("Unexpected browser API: " + url);
    },
    console: { error() {} },
    alert: (message: string) => {
      throw new Error("Unexpected alert: " + message);
    },
    navigator: {},
  });
  runInContext(script, context, { timeout: 1_000 });

  return {
    data,
    node,
    intervals,
    run: (code: string) => runInContext(code, context, { timeout: 1_000 }) as Promise<void>,
  };
}

describe("Dashboard first-run live connection feedback", () => {
  test("explains that the advanced Node CLI does not provide unattended restart", () => {
    const html = renderDashboardHtml(
      Buffer.from(JSON.stringify({ id: "owner", provider: "github" })).toString("base64"),
      JSON.stringify("https://example.test/mcp"),
      JSON.stringify("https://example.test"),
    );
    expect(html).toContain("Manual Node CLI (foreground)");
    expect(html).toContain("terminal must stay open");
  });

  test("tracks the newly enrolled agent, not another tenant/device, until Live Online", async () => {
    const page = browserHarness();
    await page.run("switchTab('add-device'); generateEnrollment()");
    expect(page.data.creates).toBe(1);
    expect(page.node("enrollStatus").textContent).toMatch(/waiting|connecting|copy/i);
    expect(page.intervals.size).toBe(1);
    expect(page.node("cmdWindows").textContent).toBe("windows command");
    expect(page.node("enrollViewDevice").hidden).toBe(true);

    page.data.devices = [
      { id: "other-online", isLiveConnected: true, status: "online" },
      { id: "agent-new", isLiveConnected: false, status: "pending" },
    ];
    await page.run("pollEnrollmentStatus()");
    expect(page.node("enrollStatus").textContent).not.toContain("Live Online");

    page.data.devices[1].isLiveConnected = true;
    page.data.devices[1].status = "online";
    await page.run("pollEnrollmentStatus()");
    expect(page.node("enrollStatus").textContent).toContain("Live Online");
    expect(page.node("enrollViewDevice").hidden).toBe(false);
    expect(page.intervals.size).toBe(0);
  });

  test("stops polling on navigation and gives a next step after timeout", async () => {
    const navigation = browserHarness();
    await navigation.run("switchTab('add-device'); generateEnrollment()");
    expect(navigation.intervals.size).toBe(1);
    await navigation.run("switchTab('clients')");
    expect(navigation.intervals.size).toBe(0);

    const reopened = browserHarness();
    await reopened.run("switchTab('add-device'); generateEnrollment()");
    expect(reopened.intervals.size).toBe(1);
    await reopened.run("switchTab('add-device')"); // Re-render clears the old command.
    expect(reopened.intervals.size).toBe(0);

    const timedOut = browserHarness();
    await timedOut.run("switchTab('add-device'); generateEnrollment()");
    await timedOut.run("enrollmentPollAttempts = 59; pollEnrollmentStatus()");
    expect(timedOut.intervals.size).toBe(0);
    expect(timedOut.node("enrollStatus").textContent).toMatch(/not online|check|retry/i);
  });

  test("shows an actionable inline error rather than an opaque alert on alias collision", async () => {
    const page = browserHarness();
    page.data.error = "Device alias already exists";
    await page.run("switchTab('add-device'); generateEnrollment()");
    expect(page.data.creates).toBe(1);
    expect(page.node("enrollError").hidden).toBe(false);
    expect(page.node("enrollError").textContent).toContain("already exists");
    expect(page.node("enrollOutput").style.display).toBe("none");
    expect(page.intervals.size).toBe(0);
  });
});
