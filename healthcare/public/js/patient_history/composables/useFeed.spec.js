import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, reactive, computed } from "vue";
import { useFeed } from "./useFeed";

const deferred = () => {
	let resolve;
	const promise = new Promise(done => {
		resolve = done;
	});
	return { promise, resolve };
};

function setup(api, patientName = "PAT-1") {
	const scope = effectScope();
	const state = scope.run(() => {
		const patient = ref(patientName),
			filters = reactive({ doctypes: [], from: null, to: null, day: null });
		const feed = useFeed(
			patient,
			filters,
			computed(() => ""),
			api,
		);
		return { ...feed, filters, patient };
	});
	return { scope, state };
}

describe("useFeed", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("ignores an older feed response and computes page count", async () => {
		const oldResponse = deferred();
		const api = {
			getFeed: vi
				.fn()
				.mockReturnValueOnce(oldResponse.promise)
				.mockResolvedValue([{ name: "new" }]),
			getFeedCount: vi.fn().mockResolvedValue(41),
		};
		const { scope, state } = setup(api);
		await nextTick();
		state.filters.doctypes = ["Vital Signs"];
		await nextTick();
		await vi.advanceTimersByTimeAsync(140);
		expect(api.getFeed).toHaveBeenCalledTimes(2);
		oldResponse.resolve([{ name: "old" }]);
		await vi.runAllTimersAsync();
		expect(state.records.value).toEqual([{ name: "new" }]);
		expect(state.totalPages.value).toBe(3);
		scope.stop();
	});

	it("clears the previous patient's records while the new feed loads", async () => {
		const nextResponse = deferred(),
			nextCount = deferred();
		const api = {
			getFeed: vi
				.fn()
				.mockResolvedValueOnce([{ name: "PAT-1 record" }])
				.mockReturnValueOnce(nextResponse.promise),
			getFeedCount: vi
				.fn()
				.mockResolvedValueOnce(1)
				.mockReturnValueOnce(nextCount.promise),
		};
		const { scope, state } = setup(api);
		await vi.runAllTimersAsync();
		expect(state.records.value).toEqual([{ name: "PAT-1 record" }]);
		expect(state.total.value).toBe(1);
		state.patient.value = "PAT-2";
		await nextTick();
		expect(state.records.value).toEqual([]);
		expect(state.total.value).toBe(0);
		nextResponse.resolve([{ name: "PAT-2 record" }]);
		nextCount.resolve(2);
		await vi.runAllTimersAsync();
		expect(state.records.value).toEqual([{ name: "PAT-2 record" }]);
		expect(state.total.value).toBe(2);
		scope.stop();
	});

	it("retries both the feed and the count", async () => {
		const api = {
			getFeed: vi
				.fn()
				.mockRejectedValueOnce(new Error("down"))
				.mockResolvedValue([{ name: "record" }]),
			getFeedCount: vi
				.fn()
				.mockRejectedValueOnce(new Error("down"))
				.mockResolvedValue(25),
		};
		const { scope, state } = setup(api);
		await vi.runAllTimersAsync();
		expect(state.error.value).toBeTruthy();
		state.retry();
		await vi.runAllTimersAsync();
		expect(state.error.value).toBe(null);
		expect(state.records.value).toEqual([{ name: "record" }]);
		expect(state.totalPages.value).toBe(2);
		scope.stop();
	});
});
