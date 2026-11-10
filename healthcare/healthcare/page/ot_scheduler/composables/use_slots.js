// The slot finder on the board: open on a waiting case in the pane, it lists the earliest free
// slots that fit (ot_booking/slots.py). Picking one moves the board to that day and outlines the
// gap; Book here books the case there through the same call a drop would make.
import { ref } from "vue";

import { get } from "../api.js";

export function useSlots({ day, filters, change }) {
	const finder = ref(closedFinder());
	const picked = ref(null);
	// each search is numbered, so only the latest one's reply is shown
	let searches = 0;

	function closedFinder() {
		return { for: null, target: null, loading: false, slots: [], error: "" };
	}

	// target is { request } or { booking }; a second click on the same card closes the finder
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
		// a reply that comes after this finder was closed, or opened on another card, is old
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
		// taken in the meantime: look again, so the list no longer offers it
		finder.value.for = null;
		find(target);
	}

	function bookingCall(target, slot) {
		const where = { theatre: slot.theatre, start: String(slot.start) };
		if (target.request)
			return ["book_request", { service_request: target.request.name, ...where }];
		return ["move_booking", { name: target.booking.name, ...where }];
	}

	// the picked slot is outlined in its theatre's column, on its own day
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
