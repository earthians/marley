// How a case looks on the board. The case and its cleaning tail share one border, so the
// two read as one block: the status colour, or a thicker red one for an emergency.

const STATUS_BORDERS = {
	Tentative: "border border-dashed border-outline-gray-4",
	Scheduled: "border border-outline-blue-4",
	"In Progress": "border border-outline-amber-5",
	Completed: "border border-outline-green-5",
};

const STATUS_FILLS = {
	Tentative: "bg-surface-gray-2",
	Scheduled: "bg-surface-blue-2",
	"In Progress": "bg-surface-amber-2",
	Completed: "bg-surface-green-2",
};

export function caseBorder(booking) {
	return booking.is_emergency
		? "border-2 border-outline-red-3"
		: STATUS_BORDERS[booking.status];
}

// A waiting case in the pane is bordered by its priority: STAT red, as on the board,
// ASAP and Urgent amber, and Routine grey
const PRIORITY_THEMES = { STAT: "red", ASAP: "amber", URGENT: "amber" };
const PRIORITY_BORDERS = {
	red: "border-2 border-outline-red-3",
	amber: "border-2 border-outline-amber-3",
	gray: "border border-outline-gray-3",
};

export function priorityTheme(row) {
	return PRIORITY_THEMES[(row.priority_label || "").toUpperCase()] || "gray";
}

export function priorityBorder(row) {
	return PRIORITY_BORDERS[priorityTheme(row)];
}

export function caseFill(booking) {
	return STATUS_FILLS[booking.status];
}
