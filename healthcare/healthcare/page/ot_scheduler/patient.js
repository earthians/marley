// A patient's age and sex in a few characters, such as "45y · F", for a card.
export function patientFacts(row) {
	return [row.age, row.sex?.charAt(0)].filter(Boolean).join(" · ");
}

// An inpatient's admission and bed, such as "Admitted · Ward A Bed 3"; empty for an outpatient
export function inpatientText(row) {
	return [row.inpatient_status, row.bed].filter(Boolean).join(" · ");
}
