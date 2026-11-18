import { frozen, post, toastError, toastSuccess } from "./api.js";
import { today } from "./time.js";

export function dayActions({
	editable,
	count,
	shownDay,
	newBooking,
	report,
	autoSchedule,
	...day
}) {
	const viewing = [{ label: __("View as Report"), onClick: report }];
	if (!editable) return viewing;
	const actions = [{ label: __("New OT Booking"), onClick: newBooking }, ...viewing];
	if (shownDay >= today())
		actions.push({
			label: __("Auto Schedule"),
			onClick: () => confirmAutoSchedule({ count, autoSchedule, ...day }),
		});
	if (shownDay >= today() && count)
		actions.push({
			label: __("Start Over"),
			onClick: () => confirmStartOver({ count, ...day }),
		});
	if (count)
		actions.push({
			label: __("Publish {0} case(s)", [count]),
			onClick: () => confirmPublish({ count, ...day }),
		});
	return actions;
}

function confirmPublish({ count, day, company, department, filters, host, reload }) {
	const date = host.format?.(day, { fieldtype: "Date" }) ?? day;
	const shown = company + (department ? `, ${department}` : "");
	window.frappe.confirm(
		__(
			"Publish {0} Tentative case(s) on {1} for {2}? They become Scheduled, their Clinical Procedures are created and the ward gets their fasting tasks. Moving or cancelling them after this needs a reason.",
			[count, date, shown],
		),
		() => publish(day, filters, reload),
	);
}

function publish(day, filters, reload) {
	dayChange(
		"publish_day",
		{ date: day, ...filters },
		"published",
		done => __("Published {0} case(s)", [done]),
		reload,
	);
}

function confirmAutoSchedule({ count, autoSchedule, day, host }) {
	if (!count) return autoSchedule();
	const date = host.format?.(day, { fieldtype: "Date" }) ?? day;
	window.frappe.confirm(
		__(
			"The {0} Tentative case(s) on {1} will be cleared and planned again with the waiting cases. Any that do not fit go back to To schedule once you book the plan. Published cases stay where they are. Continue?",
			[count, date],
		),
		autoSchedule,
	);
}

function confirmStartOver({ count, day, company, department, filters, host, reload }) {
	const date = host.format?.(day, { fieldtype: "Date" }) ?? day;
	const shown = company + (department ? `, ${department}` : "");
	window.frappe.confirm(
		__(
			"Send the {0} Tentative case(s) on {1} for {2} back to To schedule? Published cases stay where they are.",
			[count, date, shown],
		),
		() =>
			dayChange(
				"start_over_day",
				{ date: day, ...filters },
				"moved",
				done => __("Moved back {0} case(s)", [done]),
				reload,
			),
	);
}

async function dayChange(method, params, doneKey, doneText, reload) {
	const working = {
		publish_day: __("Publishing the day…"),
		start_over_day: __("Clearing the day…"),
	};
	const result = await frozen(working[method], () =>
		post(`publishing.${method}`, params).finally(reload),
	);
	if (result?.[doneKey].length) toastSuccess(doneText(result[doneKey].length));
	for (const row of result?.failed ?? [])
		toastError(`${row.patient_name || row.name}: ${row.message}`);
}
