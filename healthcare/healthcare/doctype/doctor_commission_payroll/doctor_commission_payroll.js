// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Doctor Commission Payroll", {
	refresh(frm) {
		// Read-only views — available for draft, submitted and cancelled payrolls.
		if ((frm.doc.doctors || []).length) {
			frm.add_custom_button(
				__("View Doctor"),
				() => show_view_doctor_dialog(frm),
				__("View")
			);
		}

		// Due Payment sheet — services billed in this period still awaiting payment.
		if (frm.doc.name && (frm.doc.doctors || []).length) {
			frm.add_custom_button(
				__("Doctor Due Payment"),
				() => {
					frappe.utils.print(
						"Doctor Commission Payroll",
						frm.doc.name,
						"Doctor Due Payment"
					);
				},
				__("Print")
			);
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

		// After submit: the payslips and the Additional Salary.
		if (frm.doc.docstatus === 1) {
			const primary = add_submitted_actions(frm);
			add_additional_salary_action(frm, !primary);
			return;
		}

		// Initially (draft): fetch doctors → generate commission → mark as reviewed.
		if (frm.doc.docstatus === 0 && !frm.is_new()) {
			add_draft_commission_actions(frm);
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

// ─── View Doctor: commission statement (visits, collections, due, commission) ──

function show_view_doctor_dialog(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Doctor Commission Statement"),
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
				// Switching the doctor must refresh the sheet AND the Print output —
				// otherwise the printed details stay on the first doctor loaded.
				onchange() {
					const practitioner = dialog.get_value("practitioner");
					if (!practitioner) {
						reset_doctor_statement(dialog);
						return;
					}
					if (dialog._statement && dialog._statement_practitioner === practitioner) return;
					load_doctor_statement(frm, dialog, practitioner);
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
			load_doctor_statement(frm, dialog, values.practitioner);
		},
		secondary_action_label: __("Close"),
		secondary_action() {
			dialog.hide();
		},
	});

	dialog.add_custom_action(
		__("Print"),
		() => print_selected_doctor_statement(frm, dialog),
		"btn-default"
	);

	dialog.show();

	// Show the first doctor of the payroll straight away.
	const first = (frm.doc.doctors || []).find((row) => row.practitioner);
	if (first) {
		dialog.set_value("practitioner", first.practitioner);
		load_doctor_statement(frm, dialog, first.practitioner);
	}
}

/** Drop the sheet currently on screen (used when the Doctor field is cleared). */
function reset_doctor_statement(dialog) {
	dialog._statement = null;
	dialog._statement_practitioner = null;
	dialog._loading_practitioner = null;
	if (dialog.fields_dict.view_html) dialog.fields_dict.view_html.$wrapper.html("");
}

/** Statement payload for one doctor of the payroll. */
function fetch_doctor_statement(frm, practitioner) {
	return new Promise((resolve) => {
		frm.call({
			doc: frm.doc,
			method: "view_doctor_statement",
			args: { practitioner },
			freeze: true,
			freeze_message: __("Loading doctor commission statement..."),
			callback: (r) => resolve(r && r.message ? r.message : null),
		});
	});
}

function show_doctor_statement(dialog, practitioner, statement) {
	dialog._statement = statement;
	dialog._statement_practitioner = practitioner;
	if (dialog.fields_dict.view_html) {
		dialog.fields_dict.view_html.$wrapper.html(
			healthcare_dcs.render_statement(statement, false)
		);
	}
}

function load_doctor_statement(frm, dialog, practitioner) {
	if (!practitioner) return;
	// Already showing this doctor, or already fetching it.
	if (dialog._statement && dialog._statement_practitioner === practitioner) return;
	if (dialog._loading_practitioner === practitioner) return;

	dialog._loading_practitioner = practitioner;
	fetch_doctor_statement(frm, practitioner).then((statement) => {
		dialog._loading_practitioner = null;
		if (!statement) return;
		// Ignore a late reply for a doctor the user has already switched away from.
		if (dialog.get_value("practitioner") !== practitioner) return;
		show_doctor_statement(dialog, practitioner, statement);
	});
}

/** Print the statement of the doctor currently selected in the dialog. */
async function print_selected_doctor_statement(frm, dialog) {
	const practitioner = dialog.get_value("practitioner");
	if (!practitioner) {
		frappe.msgprint(__("Select a doctor first."));
		return;
	}
	if (!dialog._statement || dialog._statement_practitioner !== practitioner) {
		// The sheet on screen belongs to another doctor — load the selected one first
		// so the printed header, cases and totals always match the chosen doctor.
		const statement = await fetch_doctor_statement(frm, practitioner);
		if (!statement) return;
		show_doctor_statement(dialog, practitioner, statement);
	}
	healthcare_dcs.print_statement(dialog._statement);
}


// ─── Initially (draft): Fetch Doctors → Generate Commission → Mark as Reviewed ─

function add_draft_commission_actions(frm) {
	const has_doctors = (frm.doc.doctors || []).length > 0;
	const has_items = (frm.doc.items || []).length > 0;
	const can_review = frm.doc.status === "Generated";

	let primary = "";
	if (!has_doctors) primary = "fetch";
	else if (!has_items) primary = "generate";
	else if (can_review) primary = "review";

	// 1. Fetch Doctors
	const fetch_btn = frm.add_custom_button(
		__("Fetch Doctors"),
		() => {
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
		},
		__("Actions")
	);
	if (primary === "fetch") fetch_btn.addClass("btn-primary");

	// 2. Generate Commission
	const generate_btn = frm.add_custom_button(
		__("Generate Commission"),
		() => {
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
		},
		__("Actions")
	);
	if (primary === "generate") generate_btn.addClass("btn-primary");

	// 3. Mark as Reviewed — after the commission has been generated
	if (can_review) {
		const review_btn = frm.add_custom_button(
			__("Mark as Reviewed"),
			() => {
				frappe.confirm(
					__(
						"Mark this payroll as reviewed? The commission cannot be regenerated after review."
					),
					() => {
						frm.call({
							doc: frm.doc,
							method: "mark_as_reviewed",
							freeze: true,
							freeze_message: __("Marking as reviewed..."),
							callback() {
								frm.reload_doc();
								frappe.show_alert({
									message: __("Marked as Reviewed."),
									indicator: "green",
								});
							},
						});
					}
				);
			},
			__("Actions")
		);
		if (primary === "review") review_btn.addClass("btn-primary");
	}

	return primary;
}


// ─── After submit: Generate Commission Payslips ──────────────────────────────

function add_submitted_actions(frm) {
	const has_items = (frm.doc.items || []).length > 0;
	if (!has_items || !frappe.model.can_create("Commission Payslip")) return "";

	const button = frm.add_custom_button(
		__("Generate Commission Payslips"),
		() => {
			frappe.confirm(
				__(
					"Generate one draft Commission Payslip per doctor, with each service split across its payment modes? Existing draft payslips for this payroll will be replaced."
				),
				() => {
					frm.call({
						doc: frm.doc,
						method: "create_commission_payslips",
						freeze: true,
						freeze_message: __("Generating Commission Payslips..."),
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
	button.addClass("btn-primary");
	return "payslips";
}


// ─── Create Additional Salary (HRMS) ─────────────────────────────────────────

function add_additional_salary_action(frm, highlight) {
	const pending = (frm.doc.doctors || []).some((row) => {
		const amount = flt(
			row.adjusted_commission != null && row.adjusted_commission !== ""
				? row.adjusted_commission
				: row.calculated_commission
		);
		return amount > 0 && !row.additional_salary;
	});
	if (!pending) return;

	const button = frm.add_custom_button(
		__("Create Additional Salary"),
		() => {
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
		},
		__("Actions")
	);
	if (highlight) button.addClass("btn-primary");
}

