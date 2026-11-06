// Copyright (c) 2017, ESS LLP and contributors
// For license information, please see license.txt

const show_consumables_message = (message, indicator = "orange") => {
	frappe.show_alert({ message, indicator }, 7);
};

frappe.ui.form.on("Clinical Procedure", {
	setup: function (frm) {
		frm.set_query("batch_no", "items", function (doc, cdt, cdn) {
			let item = locals[cdt][cdn];
			if (!item.item_code) {
				frappe.throw(__("Please enter Item Code to get Batch Number"));
			}
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
		});

		frm.set_query("service_request", () => ({
			filters: {
				patient: frm.doc.patient,
				status: "active-Request Status",
				docstatus: 1,
				template_dt: "Clinical Procedure Template",
			},
		}));
		frm.set_query("warehouse", () => ({
			filters: { company: frm.doc.company, is_group: 0 },
		}));
		frm.set_query("item_code", "items", () => ({ filters: { is_stock_item: 1 } }));
		frm.set_query("patient", () => ({ filters: { status: ["!=", "Disabled"] } }));
		frm.set_query("appointment", () => ({
			filters: {
				template_dt: "Clinical Procedure Template",
				template_dn: frm.doc.procedure_template,
				status: ["in", ["Open", "Scheduled"]],
			},
		}));
		frm.set_query("service_unit", () => ({
			filters: {
				is_group: false,
				allow_appointments: true,
				company: frm.doc.company,
			},
		}));
		frm.set_query("practitioner", () => ({
			filters: { department: frm.doc.medical_department },
		}));
		frm.set_query("insurance_policy", () => ({
			filters: { patient: frm.doc.patient, docstatus: 1 },
		}));
		frm.set_query("code_value", "codification_table", function (doc, cdt, cdn) {
			let row = frappe.get_doc(cdt, cdn);
			if (row.code_system) {
				return { filters: { code_system: row.code_system } };
			}
		});
	},

	refresh: function (frm) {
		if (frm.doc.consume_stock) {
			frm.set_indicator_formatter("item_code", function (doc) {
				return doc.qty <= doc.actual_qty ? "green" : "orange";
			});
		}

		if (frm.doc.docstatus == 1 && frm.doc.status == "In Progress") {
			add_complete_button(frm);
		} else if (frm.doc.docstatus == 1 && frm.doc.status == "Pending") {
			add_start_button(frm);
		}

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
			frm.trigger("set_warehouse");
			frappe.db
				.get_single_value("Selling Settings", "selling_price_list")
				.then(value => frm.set_value("price_list", value));
		}
	},

	patient: function (frm) {
		if (!frm.doc.patient) {
			frm.set_value({ patient_name: "", patient_age: "", patient_sex: "" });
			return;
		}
		frappe.call({
			method: "healthcare.healthcare.doctype.patient.patient.get_patient_detail",
			args: { patient: frm.doc.patient },
			callback: function (data) {
				frm.set_value({
					patient_name: data.message.patient_name,
					patient_age: patient_age(data.message),
					patient_sex: data.message.sex,
				});
			},
		});
	},

	appointment: function (frm) {
		if (!frm.doc.appointment) {
			frm.set_value({
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
			});
			return;
		}
		frappe.db
			.get_value("Patient Appointment", frm.doc.appointment, [
				"patient",
				"template_dn",
				"department",
				"practitioner",
				"appointment_date",
				"appointment_time",
				"notes",
				"service_unit",
				"company",
			])
			.then(({ message }) => {
				frm.set_value({
					patient: message.patient,
					procedure_template: message.template_dn,
					medical_department: message.department,
					practitioner: message.practitioner,
					start_date: message.appointment_date,
					start_time: message.appointment_time,
					notes: message.notes,
					service_unit: message.service_unit,
					company: message.company,
				});
			});
	},

	procedure_template: function (frm) {
		if (!frm.doc.procedure_template) {
			clear_stock_state(frm);
			frm.clear_table("codification_table");
			frm.refresh_field("codification_table");
			return;
		}
		frm.trigger("set_consume_stock");
		frm.trigger("set_medical_codes");
	},

	set_consume_stock: function (frm) {
		const could_not_load = __(
			"Consumables could not be loaded because the selected Clinical Procedure Template's stock settings could not be fetched.",
		);
		frappe.db
			.get_value(
				"Clinical Procedure Template",
				frm.doc.procedure_template,
				"consume_stock",
			)
			.then(({ message }) => {
				if (!message) {
					clear_stock_state(frm);
					show_consumables_message(could_not_load);
					return;
				}
				const consume_stock = cint(message.consume_stock);
				return frm
					.set_value("consume_stock", consume_stock)
					.then(() => load_stock_defaults(frm, consume_stock));
			})
			.catch(() => {
				clear_stock_state(frm);
				show_consumables_message(could_not_load);
			});
	},

	service_unit: function (frm) {
		if (!frm.doc.service_unit) return;
		frappe.db
			.get_value("Healthcare Service Unit", frm.doc.service_unit, "warehouse")
			.then(({ message }) => {
				if (message) frm.set_value("warehouse", message.warehouse);
			});
	},

	practitioner: function (frm) {
		if (!frm.doc.practitioner) {
			frm.set_value("practitioner_name", "");
			return;
		}
		frappe.db
			.get_value(
				"Healthcare Practitioner",
				frm.doc.practitioner,
				"practitioner_name",
			)
			.then(({ message }) =>
				frm.set_value("practitioner_name", message.practitioner_name),
			);
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
			args: { procedure_template: frm.doc.procedure_template },
			callback: function (data) {
				clear_consumables(frm);
				if (!data.message || !data.message.length) {
					show_consumables_message(
						__(
							"The selected Clinical Procedure Template does not have any consumables configured.",
						),
					);
					return;
				}
				data.message.forEach(consumable => add_consumable(frm, consumable));
				frm.refresh_field("items");
			},
			error: function () {
				clear_consumables(frm);
				show_consumables_message(
					__(
						"Consumables could not be loaded for the selected Clinical Procedure Template. Please try again.",
					),
					"red",
				);
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
				frm.clear_table("codification_table");
				if (!r.exc && r.message) {
					r.message
						.filter(code => code.code_value)
						.forEach(code => add_medical_code(frm, code));
				}
				frm.refresh_field("codification_table");
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
		if (!d.item_code) return;
		return frappe.call({
			method: "healthcare.healthcare.doctype.clinical_procedure_template.clinical_procedure_template.get_item_details",
			args: {
				args: {
					doctype: "Clinical Procedure",
					item_code: d.item_code,
					company: frm.doc.company,
					warehouse: frm.doc.warehouse,
				},
			},
			callback: function (r) {
				if (r.message) {
					Object.assign(locals[cdt][cdn], r.message);
					refresh_field("items");
				}
			},
		});
	},
});

let add_complete_button = function (frm) {
	const label = frm.doc.consume_stock ? __("Complete and Consume") : __("Complete");
	const message = frm.doc.consume_stock
		? __("Complete {0} and Consume Stock?", [frm.doc.name])
		: __("Complete {0}?", [frm.doc.name]);

	frm.add_custom_button(label, function () {
		frappe.confirm(message, () => complete_procedure(frm));
	}).addClass("btn-primary");
};

let complete_procedure = function (frm) {
	frappe.call({
		method: "complete_procedure",
		doc: frm.doc,
		freeze: true,
		callback: function (r) {
			if (r.message) {
				const link = `<a class="bold" href="/app/stock-entry/${r.message}">${r.message}</a>`;
				frappe.show_alert({
					message: __("Stock Entry {0} created", [link]),
					indicator: "green",
				});
			}
			frm.reload_doc();
		},
	});
};

let add_start_button = function (frm) {
	frm.add_custom_button(__("Start"), function () {
		frappe.call({
			doc: frm.doc,
			method: "start_procedure",
			callback: function (r) {
				if (r.exc) return;
				if (r.message == "insufficient stock") {
					offer_material_receipt(frm);
				} else {
					frm.reload_doc();
				}
			},
		});
	}).addClass("btn-primary");
};

let offer_material_receipt = function (frm) {
	const message = __(
		"Stock quantity to start the Procedure is not available in the Warehouse {0}. Do you want to record a Stock Entry?",
		[frm.doc.warehouse.bold()],
	);
	frappe.confirm(message, function () {
		frappe.call({
			doc: frm.doc,
			method: "make_material_receipt",
			freeze: true,
			callback: function (r) {
				if (r.exc) return;
				frm.reload_doc();
				let doclist = frappe.model.sync(r.message);
				frappe.set_route("Form", doclist[0].doctype, doclist[0].name);
			},
		});
	});
};

let clear_consumables = function (frm) {
	frm.clear_table("items");
	frm.refresh_field("items");
};

let clear_stock_state = function (frm) {
	frm.set_value("consume_stock", 0);
	clear_consumables(frm);
};

let load_stock_defaults = function (frm, consume_stock) {
	if (frm.doc.service_unit) {
		frm.trigger("service_unit");
	} else if (consume_stock && !frm.doc.warehouse) {
		frm.trigger("set_warehouse");
	}

	if (consume_stock) {
		frm.trigger("set_procedure_consumables");
	} else {
		show_consumables_message(
			__(
				"Consumables were not loaded because the selected Clinical Procedure Template does not consume stock.",
			),
		);
	}
};

let add_consumable = function (frm, consumable) {
	let item = frm.add_child("items");
	item.item_code = consumable.item_code;
	item.item_name = consumable.item_name;
	item.uom = consumable.uom;
	item.stock_uom = consumable.stock_uom;
	item.qty = flt(consumable.qty);
	item.transfer_qty = consumable.transfer_qty;
	item.conversion_factor = consumable.conversion_factor;
	item.invoice_separately_as_consumables =
		consumable.invoice_separately_as_consumables;
	item.batch_no = consumable.batch_no;
};

let add_medical_code = function (frm, code) {
	let child = frm.add_child("codification_table");
	child.code_value = code.code_value;
	child.code_system = code.code_system;
	child.code = code.code;
	child.description = code.description;
	child.system = code.system;
};

let patient_age = function (patient) {
	if (patient.dob) return calculate_age(patient.dob);
	if (patient.age && patient.age_as_on)
		return __("{0} as on {1}", [patient.age, patient.age_as_on]);
	return patient.age || "";
};

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
	if (!frm.doc.patient) {
		frappe.msgprint(__("Please select Patient to get prescribed procedure"));
		return;
	}
	new healthcare.ServiceRequestPicker({
		filters: {
			patient: frm.doc.patient,
			template_dt: "Clinical Procedure Template",
		},
		empty_message: __("No active procedure orders found for the selected Patient"),
		on_select: request => {
			frm.set_value({
				service_request: request.name,
				procedure_template: request.template_dn,
				practitioner: request.practitioner,
				invoiced: request.billing_status === "Invoiced" ? 1 : 0,
			});
			frm.refresh_fields();
		},
	});
<<<<<<< HEAD
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
=======
>>>>>>> 00ce686 (refactor(clinical procedure): cleanups and share the service request picker with Patient Appointment)
};
