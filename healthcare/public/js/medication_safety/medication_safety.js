// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.medication_safety");

healthcare.medication_safety = {
	/**
	 * Toast whatever the newly chosen medication triggers, worst first.
	 *
	 * A blocked or warned alert is raised by the server when the order is saved. This is only
	 * to tell the prescriber at the moment of choosing, before they have built the order.
	 */
	async show_for_medication(frm, medication) {
		if (!frm.doc.patient || !medication) return;

		const response = await frappe.call({
			method: "healthcare.healthcare.doctype.medication_alert_log.medication_alert_log.get_alerts",
			args: { patient: frm.doc.patient, medications: [medication] },
		});

		(response.message?.alerts || [])
			.filter(alert => alert.subject === medication)
			.forEach(alert => this.toast(alert));
	},

	toast(alert) {
		frappe.show_alert(
			{
				message: `<b>${frappe.utils.escape_html(
					alert.severity,
				)}</b><br>${frappe.utils.escape_html(alert.message)}`,
				indicator:
					{ Block: "red", Warn: "orange", Notify: "blue" }[alert.action] ||
					"blue",
			},
			alert.action === "Notify" ? 5 : 10,
		);
	},
};
