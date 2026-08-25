// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.DUE_MEDICATIONS_METHOD =
	"healthcare.healthcare.api.medication.get_due_medications";
healthcare.nursing.RECORD_ADMINISTRATION_METHOD =
	"healthcare.healthcare.api.medication.record_administration";

// What a nurse can do with a dose, and whether it needs a reason.
// A missed dose can still be acted on: a late dose is given late, not never.
healthcare.nursing.ACTIONABLE_DOSE_STATUSES = ["Scheduled", "Missed"];

healthcare.nursing.DOSE_OUTCOMES = [
	{ status: "Given", label: __("Given"), needs_reason: false },
	{ status: "Held", label: __("Held"), needs_reason: true },
	{ status: "Refused", label: __("Refused"), needs_reason: true },
	{ status: "Not Available", label: __("Not Available"), needs_reason: true },
];

healthcare.nursing.panes.medication = class MedicationPane extends (
	healthcare.nursing.Pane
) {
	async render() {
		this.render_layout();
		await this.refresh_doses();
	}

	render_layout() {
		this.$wrapper.html(`
			<div class="nursing-pane-head">
				<div class="nursing-pane-title">${__("Medication Administration")}</div>
			</div>
			<div class="nursing-doses"></div>
		`);
		this.$doses = this.$wrapper.find(".nursing-doses");
	}

	async refresh_doses() {
		this.doses = await frappe.xcall(healthcare.nursing.DUE_MEDICATIONS_METHOD, {
			patient: this.station.patient,
		});
		this.render_doses();
	}

	render_doses() {
		this.$doses.empty();

		if (!this.doses.length) {
			this.$doses.html(`<div class="nursing-empty">${__("Nothing due")}</div>`);
			return;
		}

		const $table = $(`
			<table class="table table-sm nursing-dose-table">
				<thead>
					<tr>
						<th>${__("Drug")}</th>
						<th class="text-right">${__("Dose")}</th>
						<th class="text-right">${__("Due")}</th>
						<th>${__("Action")}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`).appendTo(this.$doses);

		const $body = $table.find("tbody");
		this.doses.forEach(dose => $body.append(this.get_dose_html(dose)));
		$body.on("click", "[data-status]", event =>
			this.on_action($(event.currentTarget)),
		);
	}

	get_dose_html(dose) {
		return `<tr>
			<td><b>${frappe.utils.escape_html(dose.drug_name || dose.drug_code)}</b>
				${
					dose.dosage_form
						? `<span class="text-muted">· ${frappe.utils.escape_html(
								dose.dosage_form,
						  )}</span>`
						: ""
				}</td>
			<td class="text-right">${format_number(dose.dosage)}</td>
			<td class="text-right ${this.is_overdue(dose) ? "text-danger" : ""}">
				${moment(dose.scheduled_time).format("DD/MM HH:mm")}
				${
					dose.status === "Missed"
						? `<span class="sub text-danger">${__("Missed")}</span>`
						: ""
				}
			</td>
			<td>${this.get_actions_html(dose)}</td>
		</tr>`;
	}

	is_overdue(dose) {
		return (
			dose.status === "Scheduled" &&
			moment(dose.scheduled_time).isBefore(moment())
		);
	}

	// A dose already dealt with shows its outcome instead of the buttons.
	get_actions_html(dose) {
		if (!healthcare.nursing.ACTIONABLE_DOSE_STATUSES.includes(dose.status)) {
			return `<span class="text-muted">${__(dose.status)}${
				dose.reason ? ` · ${frappe.utils.escape_html(dose.reason)}` : ""
			}</span>`;
		}

		return `<div class="nursing-row-actions">
			${healthcare.nursing.DOSE_OUTCOMES.map(
				outcome => `<button type="button" class="btn btn-xs btn-default"
					data-status="${outcome.status}" data-dose="${dose.name}">${outcome.label}</button>`,
			).join("")}
		</div>`;
	}

	on_action($button) {
		const status = $button.attr("data-status");
		const dose = $button.attr("data-dose");
		const outcome = healthcare.nursing.DOSE_OUTCOMES.find(
			one => one.status === status,
		);

		if (!outcome.needs_reason) {
			this.record(dose, status);
			return;
		}

		this.ask_reason(dose, status, outcome.label);
	}

	ask_reason(dose, status, label) {
		frappe.prompt(
			{
				fieldtype: "Small Text",
				fieldname: "reason",
				label: __("Why was this dose {0}?", [label.toLowerCase()]),
				reqd: 1,
			},
			values => this.record(dose, status, values.reason),
			__("Record {0}", [label]),
		);
	}

	async record(dose, status, reason) {
		await frappe.xcall(healthcare.nursing.RECORD_ADMINISTRATION_METHOD, {
			administration: dose,
			status: status,
			reason: reason,
		});
		frappe.show_alert({
			message: __("{0} recorded", [__(status)]),
			indicator: "green",
		});
		await this.refresh_doses();
		this.station.snapshot.refresh();
	}
};
