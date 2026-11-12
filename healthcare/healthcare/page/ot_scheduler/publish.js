import { post, showError, toastError, toastSuccess } from "./api.js";
import { today } from "./time.js";

export function dayActions({ editable, count, shownDay, newBooking, report, ...day }) {
	const viewing = [{ label: "View as Report", onClick: report }];
	if (!editable) return viewing;
	const actions = [{ label: "New OT Booking", onClick: newBooking }, ...viewing];
	if (shownDay >= today() && count)
		actions.push({
			label: "Start Over",
			onClick: () => confirmStartOver({ count, ...day }),
		});
	if (count)
		actions.push({
			label: `Publish ${count} case(s)`,
			onClick: () => confirmPublish({ count, ...day }),
		});
	return actions;
}

function confirmPublish({ count, day, company, department, filters, host, reload }) {
	const date = host.format?.(day, { fieldtype: "Date" }) ?? day;
	const shown = company + (department ? `, ${department}` : "");
	window.frappe.confirm(
		`Publish ${count} Tentative case(s) on ${date} for ${shown}? They become Scheduled, their ` +
			"Clinical Procedures are created and the ward gets their fasting tasks. Moving or " +
			"cancelling them after this needs a reason.",
		() => publish(day, filters, reload),
	);
}

function publish(day, filters, reload) {
	dayChange(
		"publish_day",
		{ date: day, ...filters },
		"published",
		"Published",
		reload,
	);
}

function confirmStartOver({ count, day, company, department, filters, host, reload }) {
	const date = host.format?.(day, { fieldtype: "Date" }) ?? day;
	const shown = company + (department ? `, ${department}` : "");
	window.frappe.confirm(
		`Send the ${count} Tentative case(s) on ${date} for ${shown} back to To reschedule? ` +
			"Published cases stay where they are.",
		() =>
			dayChange(
				"start_over_day",
				{ date: day, ...filters },
				"moved",
				"Moved back",
				reload,
			),
	);
}

async function dayChange(method, params, doneKey, doneLabel, reload) {
	try {
		const result = await post(`publishing.${method}`, params);
		if (result[doneKey].length)
			toastSuccess(`${doneLabel} ${result[doneKey].length} case(s)`);
		for (const row of result.failed)
			toastError(`${row.patient_name || row.name}: ${row.message}`);
	} catch (error) {
		showError(error);
	}
	reload();
}
