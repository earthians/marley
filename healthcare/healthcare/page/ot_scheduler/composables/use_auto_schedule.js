import { ref } from "vue";

import { frozen, post, toastError, toastSuccess } from "../api.js";

export function useAutoSchedule({ filters, boardFilters, reload }) {
	const plan = ref(null);

	async function run(day) {
		const params = { date: day, ...filters(), board_filters: boardFilters() };
		const result = await frozen(__("Planning the day…"), () =>
			post("auto_schedule.plan_day", params),
		);
		if (!result) return;
		plan.value = { day, ...result };
		if (!result.placed.length && !result.not_placed.length)
			toastSuccess(__("Nothing is waiting to be scheduled on this day"));
	}

	async function book() {
		const { day, placed, lifted } = plan.value;
		const params = { date: day, ...filters(), placements: placed, lifted };
		const result = await frozen(__("Booking the plan…"), () =>
			post("auto_schedule.book_day", params).finally(() => {
				cancel();
				return reload();
			}),
		);
		if (result) report(result);
	}

	function report(result) {
		if (result.placed.length)
			toastSuccess(__("Booked {0} case(s)", [result.placed.length]));
		for (const row of result.not_placed)
			toastError(`${row.patient_name || row.name}: ${row.reason}`);
	}

	function cancel() {
		plan.value = null;
	}

	function plannedIn(theatre) {
		return plan.value?.placed.filter(row => row.theatre === theatre) ?? [];
	}

	function isLifted(name) {
		return Boolean(plan.value?.lifted.includes(name));
	}

	return { plan, run, book, cancel, plannedIn, isLifted };
}
