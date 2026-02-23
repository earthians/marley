// Copyright (c) 2017, ESS LLP and contributors
// For license information, please see license.txt

frappe.ui.form.on("Clinical Procedure", {
	setup: function (frm) {
		frm.set_query("batch_no", "items", function (doc, cdt, cdn) {
			let item = locals[cdt][cdn];
			if (!item.item_code) {
				frappe.throw(__("Please enter Item Code to get Batch Number"));
			} else {
				let filters = { item_code: item.item_code };

				if (frm.doc.status == "In Progress") {
					filters["posting_date"] =
						frm.doc.start_date || frappe.datetime.nowdate();
					if (frm.doc.warehouse) filters["warehouse"] = frm.doc.warehouse;
				}

				return {
					query: "erpnext.controllers.queries.get_batch_no",
					filters: filters,
				};
			}
		});

		frm.set_query("service_request", function () {
			return {
				filters: {
					patient: frm.doc.patient,
					status: "Active",
					docstatus: 1,
					template_dt: "Clinical Procedure template",
				},
			};
		});

		frm.set_query("warehouse", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
			};
		});

		// List Stock items
		frm.set_query("item_code", "items", function () {
			return {
				filters: {
					is_stock_item: 1,
				},
			};
		});
	},

	refresh: function (frm) {
		frm.set_query("patient", function () {
			return {
				filters: { status: ["!=", "Disabled"] },
			};
		});

		frm.set_query("appointment", function () {
			return {
				filters: {
					template_dt: "Clinical Procedure Template",
					template_dn: frm.doc.procedure_template,
					status: ["in", ["Open", "Scheduled"]],
				},
			};
		});

		frm.set_query("service_unit", function () {
			return {
				filters: {
					is_group: false,
					allow_appointments: true,
					company: frm.doc.company,
				},
			};
		});

		frm.set_query("practitioner", function () {
			return {
				filters: {
					department: frm.doc.medical_department,
				},
			};
		});

		frm.set_query("code_value", "codification_table", function (doc, cdt, cdn) {
			let row = frappe.get_doc(cdt, cdn);
			if (row.code_system) {
				return {
					filters: {
						code_system: row.code_system,
					},
				};
			}
		});

		if (frm.doc.consume_stock) {
			frm.set_indicator_formatter("item_code", function (doc) {
				return doc.qty <= doc.actual_qty ? "green" : "orange";
			});
		}

		if (frm.doc.docstatus == 1) {
			if (frm.doc.status == "In Progress") {
				let btn_label = "";
				let msg = "";
				if (frm.doc.consume_stock) {
					btn_label = __("Complete and Consume");
					msg = __("Complete {0} and Consume Stock?", [frm.doc.name]);
				} else {
					btn_label = "Complete";
					msg = __("Complete {0}?", [frm.doc.name]);
				}

				frm.add_custom_button(__(btn_label), function () {
					frappe.confirm(msg, function () {
						frappe.call({
							method: "complete_procedure",
							doc: frm.doc,
							freeze: true,
							callback: function (r) {
								if (r.message) {
									frappe.show_alert({
										message: __("Stock Entry {0} created", [
											'<a class="bold" href="/app/stock-entry/' +
												r.message +
												'">' +
												r.message +
												"</a>",
										]),
										indicator: "green",
									});
								}
								frm.reload_doc();
							},
						});
					});
				}).addClass("btn-primary");
			} else if (frm.doc.status == "Pending") {
				frm.add_custom_button(__("Start"), function () {
					frappe.call({
						doc: frm.doc,
						method: "start_procedure",
						callback: function (r) {
							if (!r.exc) {
								if (r.message == "insufficient stock") {
									let msg = __(
										"Stock quantity to start the Procedure is not available in the Warehouse {0}. Do you want to record a Stock Entry?",
										[frm.doc.warehouse.bold()],
									);
									frappe.confirm(msg, function () {
										frappe.call({
											doc: frm.doc,
											method: "make_material_receipt",
											freeze: true,
											callback: function (r) {
												if (!r.exc) {
													frm.reload_doc();
													let doclist = frappe.model.sync(
														r.message,
													);
													frappe.set_route(
														"Form",
														doclist[0].doctype,
														doclist[0].name,
													);
												}
											},
										});
									});
								} else {
									frm.reload_doc();
								}
							}
						},
					});
				}).addClass("btn-primary");
			}
		}
		frm.set_query("insurance_policy", function () {
			return {
				filters: {
					patient: frm.doc.patient,
					docstatus: 1,
				},
			};
		});
		if (frm.doc.__islocal) {
			frm.add_custom_button(__("Get from Patient Encounter"), function () {
				get_procedure_prescribed(frm);
			});
		}

		frm.add_custom_button(
			__("Clinical Note"),
			function () {
				frappe.route_options = {
					patient: frm.doc.patient,
					reference_doc: "Clinical Procedure",
					reference_name: frm.doc.name,
				};
				frappe.new_doc("Clinical Note");
			},
			__("Create"),
		);
	},

	onload: function (frm) {
		if (frm.is_new()) {
			frm.add_fetch(
				"procedure_template",
				"medical_department",
				"medical_department",
			);
			frm.set_value("start_time", null);
		}
		set_defaults(frm);
	},

	patient: function (frm) {
		if (frm.doc.patient) {
			frappe.call({
				method: "healthcare.healthcare.doctype.patient.patient.get_patient_detail",
				args: {
					patient: frm.doc.patient,
				},
				callback: function (data) {
					let age = "";
					if (data.message.dob) {
						age = calculate_age(data.message.dob);
					} else if (data.message.age) {
						age = data.message.age;
						if (data.message.age_as_on) {
							age = __("{0} as on {1}", [age, data.message.age_as_on]);
						}
					}
					frm.set_value("patient_name", data.message.patient_name);
					frm.set_value("patient_age", age);
					frm.set_value("patient_sex", data.message.sex);
				},
			});
		} else {
			frm.set_value("patient_name", "");
			frm.set_value("patient_age", "");
			frm.set_value("patient_sex", "");
		}
	},

	appointment: function (frm) {
		if (frm.doc.appointment) {
			frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "Patient Appointment",
					name: frm.doc.appointment,
				},
				callback: function (data) {
					let values = {
						patient: data.message.patient,
						procedure_template: data.message.template_dn,
						medical_department: data.message.department,
						practitioner: data.message.practitioner,
						start_date: data.message.appointment_date,
						start_time: data.message.appointment_time,
						notes: data.message.notes,
						service_unit: data.message.service_unit,
						company: data.message.company,
					};
					frm.set_value(values);
				},
			});
		} else {
			let values = {
				patient: "",
				patient_name: "",
				patient_sex: "",
				patient_age: "",
				medical_department: "",
				procedure_template: "",
				start_date: "",
				start_time: "",
				notes: "",
				service_unit: "",
				inpatient_record: "",
			};
			frm.set_value(values);
		}
	},

	procedure_template: function (frm) {
		if (frm.doc.procedure_template) {
			frappe.call({
				method: "healthcare.healthcare.utils.get_medical_codes",
				args: {
					template_dt: "Clinical Procedure Template",
					template_dn: frm.doc.procedure_template,
				},
				callback: function (r) {
					if (!r.exc && r.message) {
						frm.doc.codification_table = [];
						$.each(r.message, function (k, val) {
							if (val.code_value) {
								var child = frm.add_child("codification_table");
								child.code_value = val.code_value;
								child.code_system = val.code_system;
								child.code = val.code;
								child.description = val.description;
								child.system = val.system;
							}
						});
						frm.refresh_field("codification_table");
					} else {
						frm.clear_table("codification_table");
						frm.refresh_field("codification_table");
					}
				},
			});
		} else {
			frm.clear_table("codification_table");
			frm.refresh_field("codification_table");
		}
	},

	service_unit: function (frm) {
		if (frm.doc.service_unit) {
			frappe.call({
				method: "frappe.client.get_value",
				args: {
					fieldname: "warehouse",
					doctype: "Healthcare Service Unit",
					filters: { name: frm.doc.service_unit },
				},
				callback: function (data) {
					if (data.message) {
						frm.set_value("warehouse", data.message.warehouse);
					}
				},
			});
		}
	},

	practitioner: function (frm) {
		if (frm.doc.practitioner) {
			frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "Healthcare Practitioner",
					name: frm.doc.practitioner,
				},
				callback: function (data) {
					frappe.model.set_value(
						frm.doctype,
						frm.docname,
						"practitioner_name",
						data.message.practitioner_name,
					);
				},
			});
		} else {
			frappe.model.set_value(frm.doctype, frm.docname, "practitioner_name", "");
		}
	},

	set_warehouse: function (frm) {
		if (!frm.doc.warehouse) {
			frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Stock Settings",
					fieldname: "default_warehouse",
				},
				callback: function (data) {
					frm.set_value("warehouse", data.message.default_warehouse);
				},
			});
		}
	},

	set_procedure_consumables: function (frm) {
		frappe.call({
			method: "healthcare.healthcare.doctype.clinical_procedure.clinical_procedure.get_procedure_consumables",
			args: {
				procedure_template: frm.doc.procedure_template,
			},
			callback: function (data) {
				if (data.message) {
					frm.doc.items = [];
					$.each(data.message, function (i, v) {
						let item = frm.add_child("items");
						item.item_code = v.item_code;
						item.item_name = v.item_name;
						item.uom = v.uom;
						item.stock_uom = v.stock_uom;
						item.qty = flt(v.qty);
						item.transfer_qty = v.transfer_qty;
						item.conversion_factor = v.conversion_factor;
						item.invoice_separately_as_consumables =
							v.invoice_separately_as_consumables;
						item.batch_no = v.batch_no;
					});
					refresh_field("items");
				}
			},
		});
	},

	set_medical_codes: function (frm) {
		frappe.call({
			method: "healthcare.healthcare.utils.get_medical_codes",
			args: {
				template_dt: "Clinical Procedure Template",
				template_dn: frm.doc.procedure_template,
			},
			callback: function (r) {
				if (!r.exc && r.message) {
					frm.doc.codification_table = [];
					$.each(r.message, function (k, val) {
						if (val.code_value) {
							var child = frm.add_child("codification_table");
							child.code_value = val.code_value;
							child.code_system = val.code_system;
							child.code = val.code;
							child.description = val.description;
							child.system = val.system;
						}
					});
					frm.refresh_field("codification_table");
				}
			},
		});
	},
});

frappe.ui.form.on("Clinical Procedure Item", {
	qty: function (frm, cdt, cdn) {
		let d = locals[cdt][cdn];
		frappe.model.set_value(cdt, cdn, "transfer_qty", d.qty * d.conversion_factor);
	},

	uom: function (doc, cdt, cdn) {
		let d = locals[cdt][cdn];
		if (d.uom && d.item_code) {
			return frappe.call({
				method: "erpnext.stock.doctype.stock_entry.stock_entry.get_uom_details",
				args: {
					item_code: d.item_code,
					uom: d.uom,
					qty: d.qty,
				},
				callback: function (r) {
					if (r.message) {
						frappe.model.set_value(cdt, cdn, r.message);
					}
				},
			});
		}
	},

	item_code: function (frm, cdt, cdn) {
		let d = locals[cdt][cdn];
		let args = null;
		if (d.item_code) {
			args = {
				doctype: "Clinical Procedure",
				item_code: d.item_code,
				company: frm.doc.company,
				warehouse: frm.doc.warehouse,
			};
			return frappe.call({
				method: "healthcare.healthcare.doctype.clinical_procedure_template.clinical_procedure_template.get_item_details",
				args: { args: args },
				callback: function (r) {
					if (r.message) {
						let d = locals[cdt][cdn];
						$.each(r.message, function (k, v) {
							d[k] = v;
						});
						refresh_field("items");
					}
				},
			});
		}
	},
});

let calculate_age = function (birth) {
	let ageMS = Date.parse(Date()) - Date.parse(birth);
	let age = new Date();
	age.setTime(ageMS);
	let years = age.getFullYear() - 1970;
	return `${years} ${__("Years(s)")} ${age.getMonth()} ${__(
		"Month(s)",
	)} ${age.getDate()} ${__("Day(s)")}`;
};

let get_procedure_prescribed = function (frm) {
	if (frm.doc.patient) {
		show_orders(frm);
	} else {
		frappe.msgprint(__("Please select Patient to get prescribed procedure"));
	}
};

let show_orders = function (frm) {
	const d = new frappe.ui.Dialog({
		title: __("Select a Service Request"),
		fields: [
			{
				fieldname: "service_html",
				fieldtype: "HTML",
				options: `
					<div id="service-request-list"
						style="max-height: 420px; overflow-y: auto; padding-right: 5px;">
						No active procedure orders found for the selected Patient
					</div>
				`,
			},
		],
		primary_action_label: __("Select"),
		primary_action() {
			const selected = d.$wrapper.find('.service-row[data-selected="true"]')[0];
			if (!selected) {
				frappe.msgprint(__("Please select a service request."));
				return;
			}

			const selected_id = selected.dataset.name;
			if (selected_id) {
				frappe.db.get_doc("Service Request", selected_id).then(doc => {
					frm.set_value({
						service_request: selected_id,
						procedure_template: doc.template_dn,
						practitioner: doc.practitioner,
						invoiced: doc.billing_status === "Invoiced" ? 1 : 0,
					});
					frm.refresh_fields();
				});
			}

			d.hide();
		},
	});
	d.show();

	frappe.db
		.get_list("Service Request", {
			fields: [
				"name",
				"order_group",
				"order_date",
				"practitioner",
				"practitioner_name",
				"template_dt",
				"template_dn",
				"status",
				"coverage_status",
				"billing_status",
			],
			filters: {
				patient: frm.doc.patient,
				template_dt: "Clinical Procedure Template",
				status: "active-Request Status",
			},
		})
		.then(r => {
			const data = r || [];

			if (data.length) {
				const html = get_service_request_list_html(data);
				const wrapper = d.fields_dict.service_html.$wrapper;
				wrapper.html(html);

				wrapper.find(".service-row").each(function () {
					const row = this;

					row.addEventListener("mouseenter", function () {
						if (row.dataset.selected !== "true") {
							row.style.backgroundColor = "#fafafa";
						}
					});

					row.addEventListener("mouseleave", function () {
						if (row.dataset.selected !== "true") {
							row.style.backgroundColor = "";
						}
					});

					row.addEventListener("click", function () {
						wrapper.find(".service-row").each(function () {
							this.dataset.selected = "false";
							this.style.border = "1px solid #dddaaa";
							this.style.backgroundColor = "";
						});

						row.dataset.selected = "true";
						row.style.border = "2px solid #afafaf";
						row.style.backgroundColor = "#f3f3f3";
					});
				});
			} else {
				d.$wrapper.find(".modal-footer .btn-primary").hide();
			}
		});
};

let set_defaults = function (frm) {
	if (frm.is_new()) {
		frappe.db
			.get_single_value("Stock Settings", "default_warehouse")
			.then(value => {
				frm.set_value("warehouse", value);
			});

		frappe.db
			.get_single_value("Selling Settings", "selling_price_list")
			.then(value => {
				frm.set_value("price_list", value);
			});
	}
};

let get_service_request_list_html = function (data) {
	let html = `
		<div style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 5px;">
	`;

	data.forEach(row => {
		// trimming the last part of template_dt (Template, Type etc)
		const service_type = (row.template_dt || "").trim().split(" ").pop();

		const coverage_status = (row.coverage_status || "").toLowerCase();
		const status_clr = coverage_status.includes("approved")
			? "green"
			: coverage_status.includes("pending") ||
			    coverage_status.includes("requested")
			  ? "orange"
			  : "gray";
		const status_txt = row.coverage_status || "NA";

		html += `
			<div class="service-row"
				data-name="${row.name}"
				data-selected="false"
				style="
				border: 1px solid #dddaaa;
				border-radius: 6px;
				padding: 12px;
				cursor: pointer;
				transition: all 0.2s ease-in-out;
			">
				<div style="display: flex; justify-content: space-between; align-items: center;">
					<div style="font-size: 1rem;">
						${service_type}: <b>${row.template_dn || ""}</b>
					</div>
					<span class="indicator ${status_clr}">${status_txt}</span>
				</div>

				<div style="display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.875rem; color: #4b4b4b;">
					<div style="display: flex; flex-direction: column; align-items: flex-start; text-align: left;">
						<div>${row.order_group || ""}</div>
						<div style="color: gray;">${frappe.datetime.str_to_user(row.order_date) || ""}</div>
					</div>
					<div style="display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
						<div>${row.practitioner || ""}</div>
						<div style="color: gray;">${row.practitioner_name || ""}</div>
					</div>
				</div>
			</div>
		`;
	});

	html += "</div>";
	return html;
};
