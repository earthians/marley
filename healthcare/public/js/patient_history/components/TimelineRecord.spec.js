import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import TimelineRecord from "./TimelineRecord.vue";

let app;
afterEach(() => {
    app?.unmount();
    document.body.innerHTML = "";
});
describe("TimelineRecord", () => {
    it("expands once and requests a sanitized document payload through the adapter", async() => {
        const target = document.createElement("div");
        document.body.append(target);
        const api = {
            renderDocAsHtml: vi.fn().mockResolvedValue({ html: "<p>Details</p>" }),
        };
        app = createApp(TimelineRecord, {
            record: {
                name: "PMR-1",
                reference_doctype: "Patient Encounter",
                reference_name: "ENC-1",
                communication_date: "2026-10-13",
                practitioner_name: "Dr Example",
            },
            api,
            initiallyExpanded: false,
        });
        app.config.globalProperties.__ = value => value;
        globalThis.moment = value => ({ format: () => value });
        app.config.globalProperties.moment = globalThis.moment;
        app.config.globalProperties.frappe = { set_route: vi.fn() };
        app.mount(target);
        await nextTick();
        target.querySelector(".ph-toggle-record").click();
        await new Promise(resolve => setTimeout(resolve, 0));
        await nextTick();
        expect(api.renderDocAsHtml).toHaveBeenCalledWith("Patient Encounter", "ENC-1");
        expect(target.querySelector(".document-html").textContent).toBe("Details");
    });
});
