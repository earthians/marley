import { computed, ref, watch } from "vue";

import { get, showError } from "../api.js";
import { today } from "../time.js";

export function useBoardLoad({ day, company, department }) {
	const board = ref(null);
	const requests = ref([]);
	const postponed = ref([]);
	let loads = 0;
	let companyFromServer = false;

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
	watch(company, () => {
		if (companyFromServer) return (companyFromServer = false);
		department.value = "";
		load();
	});
	watch(department, load);

	return { board, requests, postponed, load, filters, current };
}
