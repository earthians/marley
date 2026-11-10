// A case's menu on the board, opened with a left or right click: view it, create its
// procedures, reschedule it, or move it to its next status. Cancelling a published or started
// case, or taking it back to Tentative, needs a reason; cancelling a Tentative one only a confirm, so a
// click cannot cancel it by mistake. A viewer who
// cannot change bookings gets View alone.

export function caseMenu(
	booking,
	{ canEdit, open, createProcedures, reschedule, change, askReason },
) {
	const actions = [{ label: "View", onClick: () => open(booking.name) }];
	if (!canEdit) return [{ group: "Booking", hideLabel: true, options: actions }];
	if (booking.next_statuses.includes("Postponed"))
		actions.push({
			label: booking.status === "Scheduled" ? "Reschedule…" : "Reschedule",
			onClick: () => reschedule(booking),
		});
	if (booking.procedures_pending)
		actions.push({
			label: "Create Procedures",
			onClick: () => createProcedures(booking),
		});
	return [
		{ group: "Booking", hideLabel: true, options: actions },
		{ group: "Change status", options: statusOptions(booking, change, askReason) },
	];
}

// Postponed is left out: a case goes back to the pane with Reschedule
function statusOptions(booking, change, askReason) {
	const options = booking.next_statuses
		.filter(status => status !== "Postponed")
		.map(status => statusOption(booking, status, change, askReason));
	if (!options.length)
		options.push({ label: `No change from ${booking.status}`, disabled: true });
	return options;
}

function statusOption(booking, status, change, askReason) {
	const params = statusParams(booking, status);
	if (status === "Cancelled")
		return {
			label: "Cancel…",
			theme: "red",
			onClick: () => cancel(booking, change, askReason),
		};
	// only a Scheduled case goes back to Tentative, which unpublishes it
	if (status === "Tentative")
		return {
			label: "Tentative…",
			onClick: () => askReason("set_status", params, "Unpublish"),
		};
	return { label: status, onClick: () => change("set_status", params) };
}

function cancel(booking, change, askReason) {
	const params = statusParams(booking, "Cancelled");
	// a published or started case needs a reason, as the server says
	if (booking.needs_reason) return askReason("set_status", params, "Cancel");
	window.frappe.confirm(`Cancel ${booking.patient_name}'s case?`, () =>
		change("set_status", params),
	);
}

export function statusParams(booking, status) {
	return { name: booking.name, status };
}
