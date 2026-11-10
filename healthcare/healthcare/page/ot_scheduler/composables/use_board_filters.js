// The board's practitioner, patient and theatre filters (board_filters.vue): what they leave out
// is dimmed, not hidden, so the free time around the rest still shows.
import { ref } from "vue";

export function useBoardFilters() {
	const practitioner = ref("");
	const patient = ref("");
	const theatre = ref("");

	function caseDimmed(booking) {
		if (practitioner.value && !booking.team_ids?.includes(practitioner.value))
			return true;
		if (patient.value && booking.patient !== patient.value) return true;
		return theatreDimmed(booking.theatre);
	}

	function theatreDimmed(name) {
		return Boolean(theatre.value) && name !== theatre.value;
	}

	// the filters that are set, for the OT Day Schedule report to print the same cases
	function sheetFilters() {
		const set = {
			practitioner: practitioner.value,
			patient: patient.value,
			theatre: theatre.value,
		};
		return Object.fromEntries(Object.entries(set).filter(([, value]) => value));
	}

	return { practitioner, patient, theatre, caseDimmed, theatreDimmed, sheetFilters };
}
