import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import VitalChart from "./VitalChart.vue";

let app;
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; });
describe("VitalChart", () => {
  it("plots points against time and exposes an accessible SVG", async () => {
    globalThis.__ = value => value;
    globalThis.moment = value => ({ isValid: () => Number.isFinite(new Date(value).getTime()), valueOf: () => new Date(value).getTime(), format: () => "01 Jan" });
    window.moment = globalThis.moment;
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.matchMedia = () => ({ matches: false });
    SVGElement.prototype.getTotalLength = () => 100;
    const target = document.createElement("div"); document.body.append(target);
    app = createApp(VitalChart, { metric: "temperature", rows: [{ signs_date: "2026-01-01", temperature: 36.5 }, { signs_date: "2026-01-02", temperature: 37 }], config: { title: "Temperature", series: [{ key: "temperature", label: "Temperature", unit: "°C", color: "red", band: [36, 38] }], range: [35, 40] }, range: "all", hiddenSeries: [] });
    app.config.globalProperties.__ = value => value;
    app.config.globalProperties.moment = window.moment;
    app.mount(target); await nextTick();
    expect(target.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(target.querySelectorAll("circle.ph-vital-dot")).toHaveLength(2);
    expect(target.querySelector("path.ph-chart-line").getAttribute("d")).toMatch(/^M.*C/);
    expect(target.querySelectorAll("circle.ph-vital-hit")).toHaveLength(2);
    expect(target.querySelector(".ph-chart-crosshair")).toBeNull();
    target.querySelector(".ph-vital-hit").focus();
    await nextTick();
    expect(target.querySelector(".ph-chart-tooltip")).not.toBeNull();
    target.querySelector("svg").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(target.querySelector(".ph-chart-tooltip")).toBeNull();
  });
});
