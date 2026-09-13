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
				frappe.show_alert({
					message: msg,
					indicator: "green",
				});
			}
		},
	});
}
