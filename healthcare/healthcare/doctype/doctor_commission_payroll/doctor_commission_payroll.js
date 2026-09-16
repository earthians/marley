// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Doctor Commission Payroll", {
	refresh(frm) {
		if (frm.doc.docstatus === 1) {
			const pending = (frm.doc.doctors || []).some((d) => {
				const amt = flt(
					d.adjusted_commission != null && d.adjusted_commission !== ""
						? d.adjusted_commission
						: d.calculated_commission
				);
				return amt > 0 && !d.additional_salary;
			});
			if (pending) {
				frm
					.add_custom_button(__("Create Additional Salary"), () => {
						if (!frm.doc.salary_component) {
							frappe.msgprint({
								title: __("Salary Component Required"),
								message: __(
									"Set Salary Component on this document (or in Healthcare Settings) before creating Additional Salary."
								),
								indicator: "orange",
							});
							return;
						}
						frappe.confirm(
							__(
								"Create Additional Salary for each doctor with commission amount? These will be linked for payroll processing."
							),
							() => {
								frm.call({
									doc: frm.doc,
									method: "create_additional_salary",
									freeze: true,
									freeze_message: __("Creating Additional Salary..."),
									callback(r) {
										frm.reload_doc();
										if (r.message) {
											frappe.show_alert({
												message: __(
													"Created {0} Additional Salary record(s). Skipped {1}.",
													[r.message.created || 0, r.message.skipped || 0]
												),
												indicator: "green",
											});
											if (r.message.errors && r.message.errors.length) {
												frappe.msgprint({
													title: __("Some rows were skipped"),
													message: r.message.errors.join("<br>"),
													indicator: "orange",
												});
											}
										}
									},
								});
							}
						);
					}, __("Actions"))
					.addClass("btn-primary");
			}
		}

		// Read-only views — available for draft, submitted and cancelled payrolls.
		if ((frm.doc.doctors || []).length) {
			frm.add_custom_button(__("View Doctor"), () => show_view_doctor_dialog(frm), __("View"));
		}

		if (frm.doc.name && frappe.model.can_read("Commission Payslip")) {
			frm.add_custom_button(
				__("Commission Payslips"),
				() => {
					frappe.set_route("List", "Commission Payslip", {
						doctor_commission_payroll: frm.doc.name,
					});
				},
				__("View")
			);
		}

		if (
			frm.doc.docstatus !== 2 &&
			(frm.doc.items || []).length &&
			frappe.model.can_create("Commission Payslip")
		) {
			frm.add_custom_button(
				__("Create Commission Payslips"),
				() => {
					frappe.confirm(
						__(
							"Create one draft Commission Payslip per doctor, with each service split across its payment modes? Existing draft payslips for this payroll will be replaced."
						),
						() => {
							frm.call({
								doc: frm.doc,
								method: "create_commission_payslips",
								freeze: true,
								freeze_message: __("Creating Commission Payslips..."),
								callback(r) {
									frm.reload_doc();
									if (r.message) {
										frappe.show_alert({
											message: __(
												"Created {0} Commission Payslip(s) with {1} line(s).",
												[r.message.payslips || 0, r.message.items || 0]
											),
											indicator: "green",
										});
									}
								},
							});
						}
					);
				},
				__("Actions")
			);
		}

		if (frm.doc.docstatus !== 0) return;

		if (frm.is_new()) {
			frm.dashboard.set_headline_alert(
				__("Save first, then use Actions → Fetch Doctors or Generate Commission.")
			);
			return;
		}

		frm
			.add_custom_button(__("Fetch Doctors"), () => {
				frappe.confirm(
					__(
						"Load all Healthcare Practitioners with Receive Commission enabled into the Doctors table?"
					),
					() => {
						frm.call({
							doc: frm.doc,
							method: "fetch_doctors",
							freeze: true,
							freeze_message: __("Fetching doctors..."),
							callback(r) {
								frm.reload_doc();
								if (r.message) {
									frappe.show_alert({
										message: __("Fetched {0} doctor(s).", [r.message.doctors || 0]),
										indicator: "green",
									});
								}
							},
						});
					}
				);
			}, __("Actions"))
			.addClass("btn-primary");

		frm.add_custom_button(__("Generate Commission"), () => {
			frappe.confirm(
				__(
					"This will clear existing doctor/service rows and recalculate commission for the selected period from billed Sales Orders. Continue?"
				),
				() => {
					frappe.db
						.get_single_value("Healthcare Settings", "backdated_days_for_unpaid_commission")
						.then((days) => {
							const backdated_days = cint(days);
							if (backdated_days > 0) {
								frappe.confirm(
									__(
										"Also include late-paid services from up to {0} days before To Date? These are past services that were not commission-generated earlier but are now paid.",
										[backdated_days]
									),
									() => run_generate_commission(frm, 1),
									() => run_generate_commission(frm, 0)
								);
							} else {
								run_generate_commission(frm, 0);
							}
						});
				}
			);
		}, __("Actions"));

		if (frm.doc.status === "Generated") {
			frm.add_custom_button(__("Mark Reviewed"), () => {
				frm.set_value("status", "Reviewed");
				frm.save();
			}, __("Actions"));
		}
	},

	from_date(frm) {
		if (!frm.doc.default_commission_percent && frm.doc.default_commission_percent !== 0) {
			frappe.db.get_single_value("Healthcare Settings", "doctors_commission").then((v) => {
				if (v != null) frm.set_value("default_commission_percent", v);
			});
		}
		if (!frm.doc.salary_component) {
			frappe.db
				.get_single_value("Healthcare Settings", "doctor_commission_salary_component")
				.then((v) => {
					if (v) frm.set_value("salary_component", v);
				});
		}
	},

	to_date(frm) {
		if (frm.doc.to_date && !frm.doc.payroll_date) {
			frm.set_value("payroll_date", frm.doc.to_date);
		}
	},
});

function run_generate_commission(frm, include_backdated) {
	frm.call({
		doc: frm.doc,
		method: "generate_commission",
		args: { include_backdated: include_backdated ? 1 : 0 },
		freeze: true,
		freeze_message: __("Generating doctor commission..."),
		callback(r) {
			frm.reload_doc();
			if (r.message) {
				let msg = __(
					"Generated {0} doctor(s), {1} service line(s).",
					[r.message.doctors || 0, r.message.items || 0]
				);
				if (cint(r.message.backdated_items)) {
					msg +=
						" " +
						__("Included {0} late-paid backdated line(s).", [r.message.backdated_items]);
				}
				if (cint(r.message.payslips)) {
					msg +=
						" " +
						__("Created {0} draft Commission Payslip(s).", [r.message.payslips]);
				}
				frappe.show_alert({
					message: msg,
					indicator: "green",
				});
			}
		},
	});
}

// ─── View Doctor: services, payment modes per service and commission ──────────

function show_view_doctor_dialog(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("View Doctor Commission"),
		size: "extra-large",
		fields: [
			{
				fieldname: "practitioner",
				fieldtype: "Link",
				options: "Healthcare Practitioner",
				label: __("Doctor"),
				reqd: 1,
				get_query() {
					const names = (frm.doc.doctors || [])
						.map((row) => row.practitioner)
						.filter(Boolean);
					return { filters: { name: ["in", names.length ? names : [""]] } };
				},
			},
			{ fieldtype: "Section Break" },
			{ fieldname: "view_html", fieldtype: "HTML" },
		],
		primary_action_label: __("View"),
		primary_action(values) {
			if (!values.practitioner) {
				frappe.msgprint(__("Select a doctor first."));
				return;
			}
			load_doctor_view(frm, dialog, values.practitioner);
		},
		secondary_action_label: __("Close"),
		secondary_action() {
			dialog.hide();
		},
	});

	dialog.add_custom_action(
		__("Print"),
		() => {
			if (!dialog._doctor_view) {
				frappe.msgprint(__("View a doctor first."));
				return;
			}
			print_doctor_view(build_doctor_view_html(dialog._doctor_view, true));
		},
		"btn-default"
	);

	dialog.show();
}

function load_doctor_view(frm, dialog, practitioner) {
	frappe.call({
		doc: frm.doc,
		method: "view_doctor_commission",
		args: { practitioner },
		freeze: true,
		freeze_message: __("Loading doctor commission..."),
		callback(r) {
			if (!r.message) return;
			dialog._doctor_view = r.message;
			dialog.fields_dict.view_html.$wrapper.html(build_doctor_view_html(r.message, false));
		},
	});
}

function print_doctor_view(html) {
	const win = window.open("", "_blank", "width=1200,height=800");
	if (!win) {
		frappe.msgprint(__("Allow pop-ups for this site to print."));
		return;
	}
	win.document.open();
	win.document.write(html);
	win.document.close();
	win.focus();
	win.print();
}

function dcv_escape(value) {
	if (value === null || value === undefined || value === "") return "";
	const el = document.createElement("div");
	el.textContent = String(value);
	return el.innerHTML;
}

function dcv_money(value) {
	return frappe.format(flt(value), { fieldtype: "Currency" });
}

function dcv_date(value) {
	return value ? frappe.datetime.str_to_user(value) : "";
}

function dcv_modes_for_service(service) {
	const modes = service.modes || [];
	if (modes.length) return modes;
	return [
		{
			mode_of_payment: "",
			payment_mode_percent: 100,
			service_amount: service.service_amount,
			commission_amount: service.commission_amount,
		},
	];
}

function build_doctor_view_html(data, for_print) {
	const doctor = data.doctor || {};
	const services = data.services || [];

	const body = services
		.map((service) => {
			const modes = dcv_modes_for_service(service);
			return modes
				.map((mode, index) => {
					const spanning =
						index === 0
							? `<td rowspan="${modes.length}">${dcv_date(service.transaction_date)}</td>
								<td rowspan="${modes.length}">${dcv_escape(service.patient_name || service.patient)}</td>
								<td rowspan="${modes.length}">${dcv_escape(service.item_name || service.item_code)}</td>
								<td rowspan="${modes.length}">${dcv_escape(service.sales_order)}</td>`
							: "";
					return `<tr>${spanning}
						<td>${dcv_escape(mode.mode_of_payment) || "—"}</td>
						<td class="dcv-num">${flt(mode.payment_mode_percent)}%</td>
						<td class="dcv-num">${dcv_money(mode.service_amount)}</td>
						<td class="dcv-num">${flt(service.commission_percent)}%</td>
						<td class="dcv-num">${dcv_money(mode.commission_amount)}</td>
					</tr>`;
				})
				.join("");
		})
		.join("");

	const empty_row = `<tr><td colspan="9" class="dcv-empty">${__(
		"No billed services for this doctor in the selected period."
	)}</td></tr>`;

	const summary = [
		[__("Doctor"), doctor.practitioner_name || doctor.practitioner],
		[__("Doctor ID"), doctor.doctors_id],
		[__("Employee"), doctor.employee],
		[__("Payroll"), data.payroll],
		[__("Period"), `${dcv_date(data.from_date)} - ${dcv_date(data.to_date)}`],
		[__("Branch"), doctor.cost_center],
		[__("Cases"), doctor.cases_count],
		[__("Service Amount"), dcv_money(doctor.service_amount)],
		[__("Commission"), dcv_money(doctor.adjusted_commission)],
	];
	if (flt(doctor.adjusted_commission) !== flt(doctor.calculated_commission)) {
		summary.push([__("Calculated Commission"), dcv_money(doctor.calculated_commission)]);
	}

	const summary_html = summary
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(
			([label, value]) =>
				`<div class="dcv-meta-item"><span>${dcv_escape(label)}</span><b>${dcv_escape(
					value
				)}</b></div>`
		)
		.join("");

	const html = `
	<div class="dcv-wrap">
		<style>
			.dcv-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
			.dcv-title { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
			.dcv-sub { font-size: 12px; color: #64748b; margin-bottom: 10px; }
			.dcv-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-bottom: 12px; }
			.dcv-meta-item { font-size: 12px; }
			.dcv-meta-item span { color: #64748b; margin-right: 4px; }
			.dcv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
			.dcv-table th, .dcv-table td { border: 1px solid #cbd5e1; padding: 5px 7px; vertical-align: top; }
			.dcv-table th { background: #f1f5f9; text-align: left; font-weight: 600; }
			.dcv-num { text-align: right; white-space: nowrap; }
			.dcv-total td { font-weight: 700; background: #f8fafc; }
			.dcv-empty { text-align: center; color: #94a3b8; font-style: italic; }
		</style>
		<div class="dcv-title">${__("Doctor Commission")}</div>
		<div class="dcv-sub">${__("Services, payment modes per service and commission")}</div>
		<div class="dcv-meta">${summary_html}</div>
		<table class="dcv-table">
			<thead>
				<tr>
					<th>${__("Date")}</th>
					<th>${__("Patient")}</th>
					<th>${__("Service")}</th>
					<th>${__("Sales Order")}</th>
					<th>${__("Mode of Payment")}</th>
					<th class="dcv-num">${__("Mode %")}</th>
					<th class="dcv-num">${__("Amount")}</th>
					<th class="dcv-num">${__("Comm %")}</th>
					<th class="dcv-num">${__("Commission")}</th>
				</tr>
			</thead>
			<tbody>${body || empty_row}</tbody>
			<tfoot>
				<tr class="dcv-total">
					<td colspan="5">${__("Total")}</td>
					<td class="dcv-num"></td>
					<td class="dcv-num">${dcv_money(doctor.service_amount)}</td>
					<td class="dcv-num"></td>
					<td class="dcv-num">${dcv_money(doctor.adjusted_commission)}</td>
				</tr>
			</tfoot>
		</table>
		${
			doctor.remarks
				? `<p style="font-size:12px;color:#475569;margin-top:10px;"><b>${__(
						"Remarks"
					)}:</b> ${dcv_escape(doctor.remarks)}</p>`
				: ""
		}
	</div>`;

	if (!for_print) return html;

	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>${dcv_escape(doctor.practitioner_name || doctor.practitioner)} - ${dcv_escape(
		data.payroll
	)}</title>
</head>
<body>${html}</body>
</html>`;
}

