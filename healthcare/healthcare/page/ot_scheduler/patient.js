export function patientFacts(row) {
	return [row.age, row.sex?.charAt(0)].filter(Boolean).join(" · ");
}

export function inpatientText(row) {
	return [row.inpatient_status, row.bed].filter(Boolean).join(" · ");
}
