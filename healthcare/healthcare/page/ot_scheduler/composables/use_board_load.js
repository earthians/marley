// Loading the board for the selected day, company and department. Only the latest load's reply
// is shown: an older one finishing last is dropped. Until the board shown is the one selected,
// it is read-only, so nothing is booked on a day the user has already left.
import { computed, ref, watch } from "vue";

import { get, showError } from "../api.js";
import { today } from "../time.js";

export function useBoardLoad({ day, company, department }) {
	const board = ref(null);
	const requests = ref([]);
	const postponed = ref([]);
	// counts loads, so a reply knows whether it is still the latest
	let loads = 0;
	// the first load fills in the user's default company, which needs no second load
	let companyFromServer = false;

	// the board's set filters, for loading and publishing: an empty one arrives as "undefined"
	function filters() {
		const set = { company: company.value, department: department.value };
		return Object.fromEntries(Object.entries(set).filter(([, value]) => value));
	}

	async function load() {
		const run = ++loads;
		const selected = filters();
		try {
			const replies = await Promise.all([
				get("board.get_board", { date: day.value, ...selected }),
				get("scheduling.get_open_requests", selected),
				get("scheduling.get_postponed", selected),
			]);
			if (run !== loads) return;
			[board.value, requests.value, postponed.value] = replies;
			fillCompany();
		} catch (error) {
			if (run === loads) showError(error);
		}
	}

	function fillCompany() {
		if (company.value || !board.value.company) return;
		companyFromServer = true;
		company.value = board.value.company;
	}

	const current = computed(() => {
		const shown = board.value;
		return (
			Boolean(shown) &&
			String(shown.date) === day.value &&
			(shown.company || "") === (company.value || "") &&
			(shown.department || "") === (department.value || "")
		);
	});

	watch(day, value => (value ? load() : (day.value = today())));
	// any change of company but the first fill, the first pick of a user with no default
	// included, loads the board for the company's departments
	watch(company, () => {
		if (companyFromServer) return (companyFromServer = false);
		department.value = "";
		load();
	});
	watch(department, load);

	return { board, requests, postponed, load, filters, current };
}
