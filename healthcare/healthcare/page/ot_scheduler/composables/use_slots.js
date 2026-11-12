import { ref } from "vue";

import { get } from "../api.js";

export function useSlots({ day, filters, change }) {
	const finder = ref(closedFinder());
	const picked = ref(null);
	let searches = 0;

	function closedFinder() {
		return { for: null, target: null, loading: false, slots: [], error: "" };
	}

	async function find(target) {
		const name = (target.request || target.booking).name;
		if (finder.value.for === name) return close();
		picked.value = null;
		const search = ++searches;
		finder.value = { ...closedFinder(), for: name, target, loading: true };
		const which = target.request ? { service_request: name } : { booking: name };
		let slots = [];
		let error = "";
		try {
			slots = await get("slots.find_slots", { ...which, ...filters() });
		} catch (refusal) {
			error =
				refusal?.messages?.flat().join(" ") ||
				refusal?.message ||
				String(refusal);
		}
		if (search !== searches) return;
		Object.assign(finder.value, { slots, error, loading: false });
	}

	function pick(slot) {
		picked.value = slot;
		day.value = String(slot.date);
	}

	async function book() {
		const slot = picked.value;
		const target = finder.value.target;
		picked.value = null;
		const done = await change(...bookingCall(target, slot));
		if (done) return close();
		finder.value.for = null;
		find(target);
	}

	function bookingCall(target, slot) {
		const where = { theatre: slot.theatre, start: String(slot.start) };
		if (target.request)
			return ["book_request", { service_request: target.request.name, ...where }];
		return ["move_booking", { name: target.booking.name, ...where }];
	}

	function slotIn(theatre) {
		return (
			picked.value?.theatre === theatre && String(picked.value.date) === day.value
		);
	}

	function close() {
		searches++;
		finder.value = closedFinder();
		picked.value = null;
	}

	return { finder, picked, find, pick, book, close, slotIn };
}
