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
