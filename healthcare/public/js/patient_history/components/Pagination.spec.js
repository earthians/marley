import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import Pagination from "./Pagination.vue";

let app;
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; });
describe("Pagination", () => {
  it("shows page count and emits page changes", async () => {
    const target = document.createElement("div"); document.body.append(target);
    app = createApp(Pagination, { page: 2, pageSize: 20, total: 45, "onUpdate:page": value => target.dataset.page = value });
    app.config.globalProperties.__ = (text, values = []) => values.reduce((result, value, index) => result.replace(`{${index}}`, value), text);
    app.mount(target); await nextTick();
    expect(target.textContent).toContain("Showing 21–40 of 45 records");
    [...target.querySelectorAll("button")].find(button => button.textContent === "3").click(); await nextTick();
    expect(target.dataset.page).toBe("3");
  });
});
