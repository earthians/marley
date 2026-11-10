// A patient's age and sex in a few characters, such as "45y · F", for a card.
export function patientFacts(row) {
	return [row.age, row.sex?.charAt(0)].filter(Boolean).join(" · ");
}
