import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import ChartTooltip from "./ChartTooltip.vue";

let app;
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; });
describe("ChartTooltip", () => {
  it("shows series values, status and change from the previous reading", async () => {
    const target = document.createElement("div"); document.body.append(target);
    globalThis.__ = (text, values = []) => values.reduce((result, value, index) => result.replace(`{${index}}`, value), text);
    app = createApp(ChartTooltip, { row: { signs_date: "2026-10-13", bp_systolic: 130, bp_diastolic: 85 }, previous: { bp_systolic: 120 }, metric: "bp", config: { series: [{ key: "bp_systolic", label: "Systolic", unit: "mmHg", band: [80, 120] }, { key: "bp_diastolic", label: "Diastolic", unit: "mmHg", band: [60, 80] }] } });
    app.config.globalProperties.__ = (text, values = []) => values.reduce((result, value, index) => result.replace(`{${index}}`, value), text);
    globalThis.moment = () => ({ format: () => "13 Oct 2026" });
    app.config.globalProperties.moment = globalThis.moment;
    app.mount(target); await nextTick();
    expect(target.textContent).toContain("130 mmHg");
    expect(target.textContent).toContain("High");
    expect(target.textContent).toContain("+10 vs previous reading");
  });
});
