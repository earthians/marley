// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

/**
 * Doctor commission statement — shared renderer (view + print).
 *
 * Renders the doctor-facing sheet produced by
 * healthcare.api.doctor_commission_statement:
 *
 *   Sl.No | Date | Patient Name | File No | Visit No. | Cash/Online | Card | Due |
 *   Discount | Total | Amount | Comments
 *
 * plus the grand totals, the "<rate>% Commission for <doctor> (excluding due
 * amount)" line, the "Due for Payment" list, the payment-mode deduction notes and
 * the signature row — the same layout as the manual branch sheets.
 *
 * Loaded from healthcare.bundle.js so both Doctor Commission Payroll and
 * Commission Payslip can use it.
 */

const DCS_COLUMNS = [
	{ key: "sl_no", label: __("Sl.No"), align: "right" },
	{ key: "date", label: __("Date"), format: "date" },
	{ key: "patient_name", label: __("Patient Name") },
	{ key: "file_no", label: __("File No") },
	{ key: "visit_no", label: __("Visit No.") },
	{ key: "cash_online", label: __("Cash/Online"), align: "right", format: "money" },
	{ key: "card", label: __("Card"), align: "right", format: "money" },
	{ key: "due", label: __("Due"), align: "right", format: "money" },
	{ key: "discount", label: __("Discount"), align: "right", format: "money" },
	{ key: "total", label: __("Total"), align: "right", format: "money" },
	{ key: "amount", label: __("Amount"), align: "right", format: "money" },
	{ key: "comments", label: __("Comments") },
];

const DCS_DETAIL_COLUMNS = [
	{ key: "transaction_date", label: __("Date"), format: "date" },
	{ key: "patient_name", label: __("Patient") },
	{ key: "item_name", label: __("Service") },
	{ key: "mode_of_payment", label: __("Mode of Payment") },
	{ key: "payment_mode_percent", label: __("Mode %"), align: "right", format: "percent" },
	{ key: "service_amount", label: __("Amount"), align: "right", format: "money" },
	{ key: "deduction_percent", label: __("Deduct %"), align: "right", format: "percent" },
	{ key: "deduction_amount", label: __("Deduction"), align: "right", format: "money" },
	{ key: "net_service_amount", label: __("Net Paid"), align: "right", format: "money" },
	{ key: "commission_percent", label: __("Comm %"), align: "right", format: "percent" },
	{ key: "net_commission_amount", label: __("Commission"), align: "right", format: "money" },
];

const DCS_PENDING_COLUMNS = [
	{ key: "sl_no", label: __("Sl.No"), align: "right" },
	{ key: "date", label: __("Date"), format: "date" },
	{ key: "patient_name", label: __("Patient Name") },
	{ key: "file_no", label: __("File No") },
	{ key: "visit_no", label: __("Visit No.") },
	{ key: "cash_online", label: __("Cash/Online"), align: "right", format: "money" },
	{ key: "card", label: __("Card"), align: "right", format: "money" },
	{ key: "due", label: __("Due"), align: "right", format: "money" },
	{ key: "discount", label: __("Discount"), align: "right", format: "money" },
	{ key: "total", label: __("Total"), align: "right", format: "money" },
	{ key: "amount", label: __("Amount"), align: "right", format: "money" },
	{ key: "comments", label: __("Comments") },
];

function dcs_escape(value) {
	if (value === null || value === undefined || value === "") return "";
	const el = document.createElement("div");
	el.textContent = String(value);
	return el.innerHTML;
}

function dcs_money(value, currency) {
	// ``only_value`` keeps Frappe's right-align <div> wrapper out of the markup:
	// table cells are aligned by the ``dcs-num`` class, and the meta lines are
	// escaped as plain text (otherwise the <div …> showed up on screen).
	return frappe.format(
		flt(value),
		{
			fieldtype: "Currency",
			options: currency || undefined,
			precision: 3,
		},
		{ only_value: true }
	);
}

function dcs_percent(value) {
	const num = flt(value, 3);
	if (!num) return "-";
	return `${num}%`;
}

function dcs_date(value) {
	return value ? frappe.datetime.str_to_user(String(value).slice(0, 10)) : "";
}

function dcs_cell(row, column, currency) {
	const value = row ? row[column.key] : null;
	if (column.format === "date") return dcs_date(value);
	if (column.format === "money") return dcs_money(value, currency);
	if (column.format === "percent") return dcs_percent(value);
	return dcs_escape(value);
}


function dcs_table(columns, rows, { total_row, total_label, currency } = {}) {
	const head = columns
		.map(
			(column) =>
				`<th class="${column.align === "right" ? "dcs-num" : ""}">${dcs_escape(column.label)}</th>`
		)
		.join("");
	const body = rows.length
		? rows
				.map(
					(row) =>
						`<tr>${columns
							.map(
								(column) =>
									`<td class="${column.align === "right" ? "dcs-num" : ""}">${dcs_cell(
										row,
										column,
										currency
									)}</td>`
							)
							.join("")}</tr>`
				)
				.join("")
		: `<tr><td colspan="${columns.length}" class="dcs-empty">${__("No records.")}</td></tr>`;

	const money_keys = ["cash_online", "card", "due", "discount", "total", "amount"];
	const foot = total_row
		? `<tfoot><tr class="dcs-total">${columns
				.map((column, index) => {
					if (index === 0) {
						return `<td colspan="2">${dcs_escape(total_label || __("Grand Total"))}</td>`;
					}
					if (index === 1) return "";
					return `<td class="${column.align === "right" ? "dcs-num" : ""}">${
						money_keys.includes(column.key) ? dcs_money(total_row[column.key], currency) : ""
					}</td>`;
				})
				.join("")}</tr></tfoot>`
		: "";

	return `<table class="dcs-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

function dcs_pending_payment_rows(row, currency) {
	const payments = row.payments || [];
	if (!payments.length) return "";
	return payments
		.map(
			(payment) =>
				`<tr>
					<td>${dcs_date(payment.rv_date || row.date)}</td>
					<td>${dcs_escape(payment.rv_no)}</td>
					<td>${dcs_escape(payment.mode_of_payment)}</td>
					<td class="dcs-num">${dcs_money(payment.amount, currency)}</td>
					<td>${dcs_escape(row.branch)}</td>
				</tr>`
		)
		.join("");
}

function dcs_signature_row() {
	const blocks = [__("Prepared by"), __("Checked by"), __("Verified by"), __("Approved by")];
	return `<table class="dcs-sign"><tbody><tr>${blocks
		.map(
			(label) =>
				`<td><div class="dcs-sign-line"></div><div class="dcs-sign-label">${dcs_escape(
					label
				)}</div></td>`
		)
		.join("")}</tr></tbody></table>`;
}

function dcs_styles() {
	return `
	<style>
		.dcs-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
		.dcs-title { font-size: 16px; font-weight: 700; }
		.dcs-sub { font-size: 12px; color: #64748b; margin-bottom: 8px; }
		.dcs-meta { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-bottom: 10px; }
		.dcs-meta-item { font-size: 12px; }
		.dcs-meta-item span { color: #64748b; margin-right: 4px; }
		.dcs-section { font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
		.dcs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
		.dcs-table th, .dcs-table td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
		.dcs-table th { background: #f1f5f9; text-align: left; font-weight: 600; }
		.dcs-num { text-align: right; white-space: nowrap; }
		.dcs-total td { font-weight: 700; background: #f8fafc; }
		.dcs-empty { text-align: center; color: #94a3b8; font-style: italic; }
		.dcs-commission-line { margin-top: 10px; font-size: 13px; font-weight: 700; }
		.dcs-memo { margin-top: 2px; font-size: 12px; color: #475569; }
		.dcs-notes { margin-top: 6px; font-size: 12px; color: #475569; }
		.dcs-notes b { color: #0f172a; }
		.dcs-warn { margin: 8px 0; padding: 6px 8px; font-size: 12px; background: #fff7ed; border: 1px solid #fed7aa; }
		.dcs-sign { width: 100%; margin-top: 26px; font-size: 12px; }
		.dcs-sign td { width: 25%; padding: 0 8px; text-align: center; }
		.dcs-sign-line { border-bottom: 1px solid #475569; height: 26px; }
		.dcs-sign-label { padding-top: 4px; color: #475569; }
		details.dcs-detail { margin-top: 14px; }
		details.dcs-detail > summary { cursor: pointer; font-size: 12px; color: #1d4ed8; }
	</style>`;
}

function dcs_commission_line(data) {
	const totals = data.totals || {};
	const doctor = data.doctor || {};
	const name = doctor.practitioner_name || doctor.practitioner || "";
	const rate = flt(totals.commission_percent);
	const label = rate
		? __("{0}% Commission for {1} (excluding due amount)", [rate, name])
		: __("Commission for {0} (excluding due amount)", [name]);
	const round_off = flt(totals.round_off, 3);
	const amount = round_off
		? `${dcs_money(totals.payable_rounded, data.currency)} <span class="dcs-sub">(${__(
				"round off"
		  )} ${dcs_money(round_off, data.currency)})</span>`
		: dcs_money(totals.payable, data.currency);
	const due_commission = flt(totals.due_commission, 3);
	const memo = due_commission
		? `<div class="dcs-memo">${dcs_escape(
				__("Commission on cases still shown as Due: {0}", [
					dcs_money(due_commission, data.currency),
				])
		  )}</div>`
		: "";
	return `<div class="dcs-commission-line">${dcs_escape(
		label
	)} - ${__("Round off")}: ${amount}</div>${memo}`;
}

function dcs_notes_block(data) {
	const totals = data.totals || {};
	const lines = [];
	if (flt(totals.deduction)) {
		lines.push(
			__("Total deduction on this statement: {0}", [dcs_money(totals.deduction, data.currency)])
		);
	}
	(data.notes || []).forEach((note) => lines.push(dcs_escape(note)));
	if (!lines.length) return "";
	return `<div class="dcs-notes"><b>${__("NOTE")}:</b> ${lines
		.map((line, index) => `${index + 1}) ${line}`)
		.join(" &nbsp; ")}</div>`;
}


/**
 * Render the statement payload as HTML.
 *
 * @param {object} data      payload from healthcare.api.doctor_commission_statement
 * @param {boolean} for_print wrap the markup in a printable document
 */
function render_statement(data, for_print) {
	if (!data) return "";
	const doctor = data.doctor || {};
	const totals = data.totals || {};
	const cases = data.cases || [];
	const detail = data.detail || [];
	const pending = data.pending || [];
	const currency = data.currency;

	const meta = [
		[
			__("Doctor"),
			`${doctor.practitioner_name || ""}${
				doctor.doctors_id ? ` (No.${doctor.doctors_id})` : ""
			}`,
		],
		[__("Employee"), doctor.employee],
		[__("Payroll"), data.payroll],
		[__("Payslip"), data.payslip],
		[__("Period"), `${dcs_date(data.from_date)} - ${dcs_date(data.to_date)}`],
		[__("Branches"), (doctor.branches || []).join(", ") || doctor.cost_center],
		[__("Cases"), totals.cases],
		[__("Service Amount"), dcs_money(totals.total, currency)],
		[__("Net Paid"), dcs_money(totals.net_service_amount, currency)],
		[__("Deduction"), dcs_money(totals.deduction, currency)],
		[__("Due"), dcs_money(totals.due, currency)],
	]
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(
			([label, value]) =>
				`<div class="dcs-meta-item"><span>${dcs_escape(label)}</span><b>${dcs_escape(
					value
				)}</b></div>`
		)
		.join("");

	const header = `
		<div class="dcs-title">${dcs_escape(
			__("Commission - {0} for {1}", [
				doctor.practitioner_name || doctor.practitioner || "",
				data.month_label
					? `${data.month_label} ${String(data.to_date || "").slice(0, 4)}`
					: dcs_date(data.to_date),
			])
		)}</div>
		<div class="dcs-sub">${dcs_escape(
			__("Visits, collections by mode of payment and commission")
		)}</div>
		<div class="dcs-meta">${meta}</div>`;

	const warning = flt(totals.cases_without_receipts)
		? `<div class="dcs-warn">${dcs_escape(
				__(
					"No receipt is recorded against {0} of {1} case(s) in this period, so their Due amount is shown as 0. Amount is the commission computed on the payroll.",
					[totals.cases_without_receipts, totals.cases]
				)
		  )}</div>`
		: "";

	const pending_totals = pending.reduce(
		(acc, row) => {
			["cash_online", "card", "due", "discount", "total", "amount"].forEach((key) => {
				acc[key] = flt(acc[key]) + flt(row[key]);
			});
			return acc;
		},
		{ cash_online: 0, card: 0, due: 0, discount: 0, total: 0, amount: 0 }
	);

	const pending_block = pending.length
		? `<div class="dcs-section">${dcs_escape(
				__("Due for Payment — commission not paid (pending collection)")
		  )}</div>
			${dcs_table(DCS_PENDING_COLUMNS, pending, {
				total_row: pending_totals,
				total_label: __("Grand Total (Due)"),
				currency,
			})}
			<div class="dcs-section">${dcs_escape(__("Payment details"))}</div>
			<table class="dcs-table">
				<thead><tr>
					<th>${dcs_escape(__("Date"))}</th>
					<th>${dcs_escape(__("RV No"))}</th>
					<th>${dcs_escape(__("Mode"))}</th>
					<th class="dcs-num">${dcs_escape(__("Amount"))}</th>
					<th>${dcs_escape(__("Branch"))}</th>
				</tr></thead>
				<tbody>${pending
					.map((row) => dcs_pending_payment_rows(row, currency))
					.join("")}</tbody>
			</table>`
		: "";

	const detail_block = `
		<details class="dcs-detail">
			<summary>${dcs_escape(
				__("Service and payment-mode breakdown used for the commission")
			)}</summary>
			${dcs_table(DCS_DETAIL_COLUMNS, detail, { currency })}
		</details>`;

	const html = `
	${dcs_styles()}
	<div class="dcs-wrap">
		${header}
		${warning}
		${dcs_table(DCS_COLUMNS, cases, {
			total_row: totals,
			total_label: __("Grand Total (OP)"),
			currency,
		})}
		${dcs_commission_line(data)}
		${dcs_notes_block(data)}
		${pending_block}
		${detail_block}
		${dcs_signature_row()}
	</div>`;

	if (!for_print) return html;

	const title = `${doctor.practitioner_name || doctor.practitioner || ""} - ${
		data.payroll || data.payslip || ""
	}`;
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>${dcs_escape(title)}</title>
</head>
<body class="dcs-print">${html}</body>
</html>`;
}

function print_statement(data) {
	const win = window.open("", "_blank", "width=1200,height=800");
	if (!win) {
		frappe.msgprint(__("Allow pop-ups for this site to print."));
		return;
	}
	win.document.open();
	win.document.write(render_statement(data, true));
	win.document.close();
	win.focus();
	win.print();
}

window.healthcare_dcs = {
	render_statement,
	print_statement,
	columns: DCS_COLUMNS,
	detail_columns: DCS_DETAIL_COLUMNS,
	pending_columns: DCS_PENDING_COLUMNS,
};

