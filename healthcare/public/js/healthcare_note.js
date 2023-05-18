frappe.provide("healthcare");

healthcare.ClinicalNotes = class ClinicalNotes {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
		this.notes_wrapper.find('.clinical-notes-section').remove();
		frappe.run_serially([
			() => frappe.call({
				method: "get_clinical_notes",
				doc: me.frm.doc,
				args: {
					patient: me.frm.doc.patient
				},
				freeze: true,
				callback: function(r) {
					let clinical_notes = r.message || [];
					// notes.sort(
					// 	function(a, b) {
					// 		return new Date(b.added_on) - new Date(a.added_on);
					// 	}
					// );

					let clinical_notes_html = frappe.render_template(
						'healthcare_note',
						{
							clinical_notes: clinical_notes
						}
					);
					$(clinical_notes_html).appendTo(me.notes_wrapper);
				}
			}),
			() => {
				me.add_clinical_note();
				$(".clinical-notes-section").find(".edit-note-btn").on("click", function() {
					me.edit_clinical_note(this);
				});
				$(".clinical-notes-section").find(".delete-note-btn").on("click", function() {
					me.delete_clinical_note(this);
				});
			}
		])
	}


	add_clinical_note () {
		let me = this;
		let _add_clinical_note = () => {
			var d = new frappe.ui.Dialog({
				title: __('Add Clinical Note'),
				fields: [
					{
						"label": "Clinical Note Type",
						"fieldname": "note_type",
						"fieldtype": "Link",
						"options": "Clinical Note Type"
					},
					{
						"label": "Note",
						"fieldname": "note",
						"fieldtype": "Text Editor",
						"reqd": 1,
						"enable_mentions": true,
					}
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "add_clinical_note",
						doc: me.frm.doc,
						args: {
							note: data.note,
							note_type: data.note_type
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
							}
							d.hide();
						}
					});
				},
				primary_action_label: __('Add')
			});
			d.show();
		};
		$(".new-note-btn").click(_add_clinical_note);
	}

	edit_clinical_note (edit_btn) {
		var me = this;
		let row = $(edit_btn).closest('.comment-content');
		let note_name = row.attr("name");
		let note_type = $(row).find(".note-type").html().trim();
		let row_content = $(row).find(".content").html();
			var d = new frappe.ui.Dialog({
				title: __('Edit Clinical Note'),
				fields: [
					{
						"label": "Clinical Note Type",
						"fieldname": "note_type",
						"fieldtype": "Link",
						"options": "Clinical Note Type",
						"default": note_type,
					},
					{
						"label": "Note",
						"fieldname": "note",
						"fieldtype": "Text Editor",
						"default": row_content,
					}
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "edit_clinical_note",
						doc: me.frm.doc,
						args: {
							note: data.note,
							note_name: note_name
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
								d.hide();
							}

						}
					});
				},
				primary_action_label: __('Done')
			});
			d.show();
	}

	delete_clinical_note (delete_btn) {
		var me = this;
		let note_name = $(delete_btn).closest('.comment-content').attr("name");
		frappe.confirm('Are you sure you want to proceed?',
			() => {
				frappe.call({
					method: "delete_clinical_note",
					doc: me.frm.doc,
					args: {
						note_name: note_name
					},
					freeze: true,
					callback: function(r) {
						if (!r.exc) {
							me.refresh();
						}
					}
				});
			})
	}
};

healthcare.Orders = class Orders {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
		$(this.open_activities_wrapper).empty();
		let cur_form_footer = this.form_wrapper.find('.form-footer');

		// open activities
		frappe.call({
			method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.get_encounter_details",
			args: {
				patient: this.frm.doc.patient
			},
			callback: (r) => {
				if (!r.exc) {
					var activities_html = frappe.render_template('healthcare_orders', {
						service_requests: r.message[1],
						medication_requests: r.message[0]
				});

					$(activities_html).appendTo(me.open_activities_wrapper);

					$(".service-request").find(".service-request-onhold").on("click", function() {
						me.update_status(this, "Service Request", "On Hold");
					});
					$(".service-request").find(".service-request-active").on("click", function() {
						me.update_status(this, "Service Request", "Active");
					});

					$(".service-request").find(".order-cancel").on("click", function() {
						me.update_status(this, "Service Request", "Cancel");
					});

					$(".medication-request").find(".service-request-onhold").on("click", function() {
						me.update_status(this, "Medication Request", "On Hold");
					});
					$(".medication-request").find(".service-request-active").on("click", function() {
						me.update_status(this, "Medication Request", "Active");
					});

					$(".medication-request").find(".order-cancel").on("click", function() {
						me.update_status(this, "Medication Request", "Cancel");
					});

					me.create_service_request();
					me.create_medication_request();
				}
			}
		});
	}

	create_service_request () {
		let me = this;
		let _create_service_request = () => {
			var d = new frappe.ui.Dialog({
				title: __('Create Service Request'),
				fields: [
					{
						"label": "Order Template Type",
						"fieldname": "order_template_type",
						"fieldtype": "Link",
						"options": "DocType",
						"reqd": 1,
						get_query: () => {
							let order_template_doctypes = [
								"Therapy Type",
								"Lab Test Template",
								"Clinical Procedure Template",
							];
							return {
								filters: {
									name: ['in', order_template_doctypes]
								}
							};
						}
					},
					{
						"label": "Order Template",
						"fieldname": "order_template",
						"fieldtype": "Dynamic Link",
						"options": "order_template_type",
						"depends_on": "eval:doc.order_template_type;",
						"reqd": 1,
					},
					{
						"fetch_from": "order_template.medical_department",
						"fieldname": "department",
						"fieldtype": "Link",
						"label": "Department",
						"options": "Medical Department",
						"depends_on": "eval:doc.order_template_type=='Clinical Procedure Template';",
					},
					{
						"fieldname": "column_break_4",
						"fieldtype": "Column Break",
						"depends_on": "eval:doc.order_template_type=='Lab Test Template';",
					},
					{
						"fieldname": "practitioner",
						"fieldtype": "Link",
						"label": "Referred to Practitioner",
						"options": "Healthcare Practitioner",
						"depends_on": "eval:doc.order_template_type=='Clinical Procedure Template';",
					},
					{
						"fieldname": "date",
						"fieldtype": "Date",
						"label": "Date",
						"depends_on": "eval:doc.order_template_type=='Clinical Procedure Template';",
					},
					{
						"fieldname": "description",
						"fieldtype": "Small Text",
						"label": "Comments",
						"depends_on": "eval:['Lab Test Template', 'Clinical Procedure Template'].includes(doc.order_template_type);",
					},
					// therapy
					   {
						"fieldname": "no_of_sessions",
						"fieldtype": "Int",
						"label": "No of Sessions",
						"depends_on": "eval:doc.order_template_type=='Therapy Type';",
					   },
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.create_service_request",
						args: {
							encounter: me.frm.doc.name,
							data: data,
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
								d.hide();
							}

						}
					});
				},
				primary_action_label: __("Create")
			});
			d.show();
		};
		$(".new-task-btn").click(_create_service_request);
	}

	create_medication_request () {
		let me = this;
		let _create_medication_request = () => {
			var d = new frappe.ui.Dialog({
				title: __('Create Medication Request'),
				fields: [
					{
						"fieldname": "medication",
						"fieldtype": "Link",
						"in_list_view": 1,
						"label": "Medication",
						"options": "Medication",
						onchange: function(e) {
							frappe.call({
								method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.get_medications",
								freeze: true,
								args: {
									medication: d.get_value("medication")
								},
								callback: function(r) {
									if (r.message) {
										if (r.message.length == 1) {
											d.set_value("drug_code", r.message[0].item)
										}
										else if (r.message.length > 1) {
											d.set_value("drug_code", "")
											var drug_list = r.message.map(({ item }) => item);
											d.fields_dict['drug_code'].get_query = function() {
												return {
													filters: {
														name: ["in", drug_list]
													}
												};
											};
									}
									}
								}
							})

							frappe.db.get_value("Medication", d.get_value("medication"),
								["default_prescription_dosage", "default_prescription_duration",
								"dosage_form", "default_interval", "default_interval_uom", "strength", "strength_uom"])
							.then(r => {
								let values = r.message;
								d.set_values({
									"dosage": values.default_prescription_dosage,
									"period": values.default_prescription_duration,
									"dosage_form": values.dosage_form,
									"interval": values.default_interval,
									"interval_uom": values.default_interval_uom,
									"strength": values.strength,
									"strength_uom": values.strength_uom
								})
							})
						}
					},
					{
						"fieldname": "drug_code",
						"fieldtype": "Link",
						"ignore_user_permissions": 1,
						"label": "Drug Code",
						"options": "Item",
					},
					{
						"fetch_from": "medication.default_prescription_duration",
						"fieldname": "period",
						"fieldtype": "Link",
						"label": "Period",
						"options": "Prescription Duration",
						"reqd": 1
					},
					{
						"fetch_from": "medication.dosage_form",
						"fieldname": "dosage_form",
						"fieldtype": "Link",
						"label": "Dosage Form",
						"options": "Dosage Form",
						"reqd": 1
					},
					{
						"depends_on": "eval:!doc.dosage_by_interval",
						"fetch_from": "medication.default_prescription_dosage",
						"fieldname": "dosage",
						"fieldtype": "Link",
						"label": "Dosage",
						"mandatory_depends_on": "eval:!doc.dosage_by_interval",
						"options": "Prescription Dosage"
					},
					{
						"fieldname": "column_break_7",
						"fieldtype": "Column Break"
					},
					{
						"fieldname": "description",
						"fieldtype": "Small Text",
						"label": "Comment"
					},
					{
						"fetch_from": "medication.strength",
						"fieldname": "strength",
						"fieldtype": "Float",
						"label": "Strength",
						"read_only_depends_on": "eval: doc.medication"
					},
					{
						"depends_on": "strength",
						"fetch_from": "medication.strength_uom",
						"fieldname": "strength_uom",
						"fieldtype": "Link",
						"label": "Strength UOM",
						"options": "UOM",
						"read_only_depends_on": "eval: doc.medication"
					},
					{
						"fieldname": "number_of_repeats_allowed",
						"fieldtype": "Float",
						"label": "Number Of Repeats Allowed"
					},
					{
						"default": "0",
						"fieldname": "dosage_by_interval",
						"fieldtype": "Check",
						"label": "Dosage by Time Interval"
					},
					{
						"fieldname": "section_break_7",
						"fieldtype": "Section Break",
						"depends_on": "eval:doc.dosage_by_interval",
					},
					{
						"depends_on": "eval:doc.dosage_by_interval",
						"fetch_from": "medication.default_interval",
						"fieldname": "interval",
						"fieldtype": "Int",
						"label": "Interval",
						"mandatory_depends_on": "eval:doc.dosage_by_interval"
					},
					{
						"depends_on": "eval:doc.dosage_by_interval",
						"fetch_from": "medication.default_interval_uom",
						"fieldname": "interval_uom",
						"fieldtype": "Select",
						"label": "Interval UOM",
						"mandatory_depends_on": "eval:doc.dosage_by_interval",
						"options": "\nHour\nDay"
					},
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.create_service_request",
						args: {
							encounter: me.frm.doc.name,
							data: data,
							medication_request: true,
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
								d.hide();
							}

						}
					});
				},
				primary_action_label: __("Create")
			});
			d.show();

		};
		$(".new-event-btn").click(_create_medication_request);
	}

	async update_status (status_btn, doctype, status) {
		let me = this;
		let row = ""
		if (doctype == "Service Request") {
			row = $(status_btn).closest('.service-request')
		} else {
			row = $(status_btn).closest('.medication-request')
		}
		let order_name = row.attr("name");
		if (status == "Cancel") {
			frappe.confirm('Are you sure you want to proceed?',
			() => {
				frappe.call({
					method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.cancel_request",
						freeze: true,
						args: {
							doctype: doctype,
							request: order_name
						},
						callback: function(r) {
							if (r && !r.exc) {
								me.refresh();
							}
						}
				})
			})
		} else {
			await frappe.db.set_value(doctype, order_name, "status", status);
			me.refresh();
		}
	}
};