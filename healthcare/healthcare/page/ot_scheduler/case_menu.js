export function caseMenu(
	booking,
	{ canEdit, open, createProcedures, reschedule, change, askReason },
) {
	const actions = [{ label: __("View"), onClick: () => open(booking.name) }];
	if (!canEdit) return [{ group: "Booking", hideLabel: true, options: actions }];
	if (booking.next_statuses.includes("Unscheduled"))
		actions.push({
			label:
				booking.status === "Scheduled" ? __("Reschedule…") : __("Reschedule"),
			onClick: () => reschedule(booking),
		});
	if (booking.procedures_pending)
		actions.push({
			label: __("Create Procedures"),
			onClick: () => createProcedures(booking),
		});
	return [
		{ group: "Booking", hideLabel: true, options: actions },
		{
			group: __("Change status"),
			options: statusOptions(booking, change, askReason),
		},
	];
}

function statusOptions(booking, change, askReason) {
	const options = booking.next_statuses
		.filter(status => status !== "Unscheduled")
		.map(status => statusOption(booking, status, change, askReason));
	if (!options.length)
		options.push({
			label: __("No change from {0}", [__(booking.status)]),
			disabled: true,
		});
	return options;
}

function statusOption(booking, status, change, askReason) {
	const params = statusParams(booking, status);
	if (status === "Cancelled")
		return {
			label: __("Cancel…"),
			theme: "red",
			onClick: () => cancel(booking, change, askReason),
		};
	if (status === "Tentative")
		return {
			label: __("Tentative…"),
			onClick: () => askReason("set_status", params, __("Unpublish")),
		};
	return { label: __(status), onClick: () => change("set_status", params) };
}

function cancel(booking, change, askReason) {
	const params = statusParams(booking, "Cancelled");
	if (booking.needs_reason) return askReason("set_status", params, __("Cancel"));
	window.frappe.confirm(__("Cancel {0}'s case?", [booking.patient_name]), () =>
		change("set_status", params),
	);
}

export function statusParams(booking, status) {
	return { name: booking.name, status };
}
