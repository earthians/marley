import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, reactive, computed } from "vue";
import { useFeed } from "./useFeed";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe("useFeed", () => {
  it("ignores an older feed response and computes page count", async () => {
    const oldResponse = deferred();
    const api = { getFeed: vi.fn().mockReturnValueOnce(oldResponse.promise).mockResolvedValue([{ name: "new" }]), getFeedCount: vi.fn().mockResolvedValue(41) };
    const scope = effectScope();
    const state = scope.run(() => {
      const patient = ref("PAT-1"), filters = reactive({ doctypes: [], from: null, to: null, day: null });
      const feed = useFeed(patient, filters, computed(() => ""), api);
      return { ...feed, filters };
    });
    await nextTick();
    state.filters.doctypes = ["Vital Signs"];
    await nextTick(); await nextTick();
    oldResponse.resolve([{ name: "old" }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(state.records.value).toEqual([{ name: "new" }]);
    expect(state.totalPages.value).toBe(3);
    scope.stop();
  });
});
