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
	async show_for_medication(frm, medication, source = "medication", alongside = []) {
		if (!frm.doc.patient || !medication) return;

		const token = this.next_token(frm, source);

		const response = await frappe.call({
			method: "healthcare.healthcare.doctype.medication_alert_log.medication_alert_log.get_alerts",
			args: {
				patient: frm.doc.patient,
				// the rest of the order comes too: on its own a medication can only raise an
				// allergy, never an interaction with what is being prescribed beside it
				medications: this.with_the_rest_of_the_order(medication, alongside),
			},
		});

		// responses can land out of order, so drop one the prescriber has already moved past
		if (this.latest_token(frm, source) !== token) return;

		(response.message?.alerts || [])
			.filter(
				alert => alert.subject === medication || alert.against === medication,
			)
			.forEach(alert => this.toast(alert));
	},

	with_the_rest_of_the_order(medication, alongside) {
		const rest = (alongside || []).filter(name => name && name !== medication);

		return [medication, ...new Set(rest)];
	},

	next_token(frm, source) {
		frm.__medication_alert_tokens = frm.__medication_alert_tokens || {};
		frm.__medication_alert_tokens[source] =
			(frm.__medication_alert_tokens[source] || 0) + 1;

		return frm.__medication_alert_tokens[source];
	},

	latest_token(frm, source) {
		return (frm.__medication_alert_tokens || {})[source];
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
