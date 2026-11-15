import { ref } from "vue";

import { post, showError, toastError, toastSuccess } from "../api.js";

export function useAutoSchedule({ filters, boardFilters, reload }) {
	const plan = ref(null);
	const working = ref(false);

	async function run(day) {
		working.value = true;
		try {
			const params = { date: day, ...filters(), board_filters: boardFilters() };
			plan.value = { day, ...(await post("auto_schedule.plan_day", params)) };
			if (!plan.value.placed.length && !plan.value.not_placed.length)
				toastSuccess(__("Nothing is waiting to be scheduled on this day"));
		} catch (error) {
			showError(error);
		}
		working.value = false;
	}

	async function book() {
		const { day, placed, lifted } = plan.value;
		working.value = true;
		try {
			const params = { date: day, ...filters(), placements: placed, lifted };
			report(await post("auto_schedule.book_day", params));
		} catch (error) {
			showError(error);
		}
		working.value = false;
		cancel();
		reload();
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

	return { plan, working, run, book, cancel, plannedIn, isLifted };
}
