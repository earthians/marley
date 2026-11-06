// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare");

const ROW_BORDER = "1px solid #dddaaa";
const SELECTED_BORDER = "2px solid #afafaf";

// Lets the user pick one active Service Request of a patient and hands the
// chosen request to `on_select`. Used by Clinical Procedure and Patient Appointment.
healthcare.ServiceRequestPicker = class ServiceRequestPicker {
	constructor({ filters, empty_message, on_select }) {
		this.filters = { status: "active-Request Status", ...filters };
		this.on_select = on_select;
		this.make_dialog(empty_message);
		this.load_requests();
	}

	make_dialog(empty_message) {
		this.dialog = new frappe.ui.Dialog({
			title: __("Select a Service Request"),
			fields: [
				{
					fieldname: "service_html",
					fieldtype: "HTML",
					options: `<div style="max-height: 420px; overflow-y: auto; padding-right: 5px;">
						${frappe.utils.escape_html(empty_message)}
					</div>`,
				},
			],
			primary_action_label: __("Select"),
			primary_action: () => this.select(),
		});
		this.dialog.show();
	}

	async load_requests() {
		const requests = await frappe.db.get_list("Service Request", {
			fields: [
				"name",
				"order_group",
				"order_date",
				"practitioner",
				"practitioner_name",
				"template_dt",
				"template_dn",
				"coverage_status",
			],
			filters: this.filters,
		});

		if (!requests || !requests.length) {
			this.dialog.$wrapper.find(".modal-footer .btn-primary").hide();
			return;
		}
		this.wrapper = this.dialog.fields_dict.service_html.$wrapper;
		this.wrapper.html(this.list_html(requests));
		this.wrapper.find(".service-row").each((_, row) => this.bind_row(row));
	}

	bind_row(row) {
		row.addEventListener("mouseenter", () => this.set_hover(row, "#fafafa"));
		row.addEventListener("mouseleave", () => this.set_hover(row, ""));
		row.addEventListener("click", () => this.mark_selected(row));
	}

	set_hover(row, colour) {
		if (row.dataset.selected !== "true") {
			row.style.backgroundColor = colour;
		}
	}

	mark_selected(row) {
		this.wrapper.find(".service-row").each((_, other) => {
			other.dataset.selected = "false";
			other.style.border = ROW_BORDER;
			other.style.backgroundColor = "";
		});
		row.dataset.selected = "true";
		row.style.border = SELECTED_BORDER;
		row.style.backgroundColor = "#f3f3f3";
	}

	async select() {
		const selected = this.dialog.$wrapper.find(
			'.service-row[data-selected="true"]',
		)[0];
		if (!selected) {
			frappe.msgprint(__("Please select a service request."));
			return;
		}
		this.dialog.hide();
		this.on_select(
			await frappe.db.get_doc("Service Request", selected.dataset.name),
		);
	}

	list_html(requests) {
		const rows = requests.map(request => this.row_html(request)).join("");
		return `<div style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 5px;">
			${rows}
		</div>`;
	}

	row_html(request) {
		const escape = value => frappe.utils.escape_html(value || "");
		// the last word of the template doctype: "Template", "Type" and so on
		const service_type = (request.template_dt || "").trim().split(" ").pop();
		return `<div class="service-row" data-name="${escape(
			request.name,
		)}" data-selected="false"
			style="border: ${ROW_BORDER}; border-radius: 6px; padding: 12px; cursor: pointer; transition: all 0.2s ease-in-out;">
			<div style="display: flex; justify-content: space-between; align-items: center;">
				<div style="font-size: 1rem;">${escape(service_type)}: <b>${escape(
					request.template_dn,
				)}</b></div>
				<span class="indicator ${this.coverage_colour(request.coverage_status)}">
					${escape(request.coverage_status || "NA")}
				</span>
			</div>
			<div style="display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.875rem; color: #4b4b4b;">
				<div style="display: flex; flex-direction: column; align-items: flex-start; text-align: left;">
					<div>${escape(request.order_group)}</div>
					<div style="color: gray;">${escape(
						frappe.datetime.str_to_user(request.order_date),
					)}</div>
				</div>
				<div style="display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
					<div>${escape(request.practitioner)}</div>
					<div style="color: gray;">${escape(request.practitioner_name)}</div>
				</div>
			</div>
		</div>`;
	}

	coverage_colour(coverage_status) {
		const status = (coverage_status || "").toLowerCase();
		if (status.includes("approved")) return "green";
		if (status.includes("pending") || status.includes("requested")) return "orange";
		return "gray";
	}
};
