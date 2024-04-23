# -*- coding: utf-8 -*-
# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import json

import frappe
from frappe import _
from frappe.desk.reportview import get_match_cond
from frappe.model.document import Document
from frappe.model.mapper import get_mapped_doc
from frappe.utils import get_datetime, get_link_to_form, getdate, now, now_datetime, today

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account
from healthcare.healthcare.doctype.nursing_task.nursing_task import NursingTask
from healthcare.healthcare.utils import validate_nursing_tasks


class InpatientRecord(Document):
	def after_insert(self):
		frappe.db.set_value("Patient", self.patient, "inpatient_record", self.name)
		frappe.db.set_value("Patient", self.patient, "inpatient_status", self.status)

		if self.admission_encounter:  # Update encounter
			frappe.db.set_value(
				"Patient Encounter",
				self.admission_encounter,
				{"inpatient_record": self.name, "inpatient_status": self.status},
			)

			filters = {"order_group": self.admission_encounter, "docstatus": 1}
			medication_requests = frappe.get_all("Medication Request", filters, ["name"])
			service_requests = frappe.get_all("Service Request", filters, ["name"])

			for service_request in service_requests:
				frappe.db.set_value(
					"Service Request",
					service_request.name,
					{"inpatient_record": self.name, "inpatient_status": self.status},
				)

			for medication_request in medication_requests:
				frappe.db.set_value(
					"Medication Request",
					medication_request.name,
					{"inpatient_record": self.name, "inpatient_status": self.status},
				)

		if self.admission_nursing_checklist_template:
			NursingTask.create_nursing_tasks_from_template(
				template=self.admission_nursing_checklist_template,
				doc=self,
			)

		insert_pending_service_request(self)

	def validate(self):
		self.validate_dates()
		self.validate_already_scheduled_or_admitted()
		if self.status in ["Discharged", "Cancelled"]:
			frappe.db.set_value(
				"Patient", self.patient, {"inpatient_status": None, "inpatient_record": None}
			)

		set_item_rate(self)
		set_total(self)

	def validate_dates(self):
		if (getdate(self.expected_discharge) < getdate(self.scheduled_date)) or (
			getdate(self.discharge_ordered_date) < getdate(self.scheduled_date)
		):
			frappe.throw(_("Expected and Discharge dates cannot be less than Admission Schedule date"))

		for entry in self.inpatient_occupancies:
			if (
				entry.check_in
				and entry.check_out
				and get_datetime(entry.check_in) > get_datetime(entry.check_out)
			):
				frappe.throw(
					_("Row #{0}: Check Out datetime cannot be less than Check In datetime").format(entry.idx)
				)

	def validate_already_scheduled_or_admitted(self):
		query = """
			select name, status
			from `tabInpatient Record`
			where (status = 'Admitted' or status = 'Admission Scheduled')
			and name != %(name)s and patient = %(patient)s
			"""

		ip_record = frappe.db.sql(query, {"name": self.name, "patient": self.patient}, as_dict=1)

		if ip_record:
			msg = _(
				("Already {0} Patient {1} with Inpatient Record ").format(ip_record[0].status, self.patient)
				+ """ <b><a href="/app/Form/Inpatient Record/{0}">{0}</a></b>""".format(ip_record[0].name)
			)
			frappe.throw(msg)

	@frappe.whitelist()
	def admit(self, service_unit, check_in, expected_discharge=None, currency=None, price_list=None):
		admit_patient(self, service_unit, check_in, expected_discharge, currency, price_list)
		create_orders_from_treatment_counselling(self)

	@frappe.whitelist()
	def discharge(self):
		discharge_patient(self)

	@frappe.whitelist()
	def transfer(self, service_unit, check_in, leave_from=None, txred=0):
		if leave_from:
			patient_leave_service_unit(self, check_in, leave_from)
		if service_unit:
			transfer_patient(self, service_unit, check_in, txred)

	@frappe.whitelist()
	def add_service_unit_rent_to_billable_items(self):
		try:
			query = frappe.db.sql(
				f"""
				SELECT
					sum(TIMESTAMPDIFF(minute, io.check_in, now())) as now_difference,
					sum(TIMESTAMPDIFF(minute, io.check_in, io.check_out)) as time_difference,
					io.`left`,
					io.parent,
					io.name,
					sut.item,
					sut.uom,
					sut.rate,
					sut.no_of_hours,
					sut.minimum_billable_qty
				FROM
					`tabInpatient Occupancy` as io left join
					`tabHealthcare Service Unit` as su on io.service_unit=su.name left join
					`tabHealthcare Service Unit Type` as sut on su.service_unit_type=sut.name
				WHERE
					io.parent={frappe.db.escape(self.name)}
				GROUP BY
					sut.item
			""",
				as_dict=True,
			)
			for inpatient in query:
				item_name, stock_uom = frappe.db.get_value(
					"Item", inpatient.get("item"), ["item_name", "stock_uom"]
				)
				item_row = frappe.db.get_value(
					"Inpatient Record Item",
					{"item_code": inpatient.get("item"), "parent": self.name},
					["name", "quantity", "invoiced"],
					as_dict=True,
				)
				uom = 60
				if inpatient.get("uom") == "Hour":
					uom = 60
				elif inpatient.get("uom") == "Day":
					uom = 1440
				minimum_billable_qty = inpatient.get("minimum_billable_qty")
				quantity = 1
				if inpatient.get("left") == 1:
					quantity = inpatient.get("time_difference") / uom
				else:
					quantity = inpatient.get("now_difference") / uom
				if minimum_billable_qty and quantity < minimum_billable_qty:
					quantity = minimum_billable_qty
				if not item_row:
					# to add item child first time
					se_child = self.append("items")
					se_child.item_code = inpatient.get("item")
					se_child.item_name = item_name
					se_child.stock_uom = stock_uom
					se_child.uom = inpatient.get("uom")
					se_child.quantity = quantity
					se_child.rate = inpatient.rate / inpatient.get("no_of_hours")
				else:
					if item_row.get("invoiced"):
						# if invoiced add another row
						if item_row.get("quantity") and quantity and quantity > item_row.get("quantity"):
							se_child = self.append("items")
							se_child.item_code = inpatient.get("item")
							se_child.item_name = item_name
							se_child.stock_uom = stock_uom
							se_child.uom = inpatient.get("uom")
							se_child.quantity = quantity - item_row.get("quantity")
							se_child.rate = inpatient.rate / inpatient.get("no_of_hours")
					else:
						# update existing row in item line if not invoiced
						if quantity != item_row.get("quantity"):
							for item in self.items:
								if item.name == item_row.get("name"):
									item.quantity = quantity

			for test in self.inpatient_occupancies:
				if test.name == inpatient.get("name"):
					test.scheduled_billing_time = now()

			self.save()
		except Exception as e:
			frappe.log_error(message=e, title="Can't bill Service Unit occupancy")


@frappe.whitelist()
def schedule_inpatient(admission_order):
	if isinstance(admission_order, str):
		admission_order = json.loads(admission_order)  # admission order via Encounter

	if admission_order.get("treatment_plan_template") and frappe.db.get_value(
		"Treatment Plan Template",
		admission_order.get("treatment_plan_template"),
		"treatment_counselling_required_for_ip",
	):
		create_treatment_counselling(admission_order)
	else:
		create_inpatient_record(admission_order)


def create_inpatient_record(admission_order):
	if isinstance(admission_order, str):
		admission_order = json.loads(admission_order)

	if (
		not admission_order
		or not admission_order["patient"]
		or not admission_order["admission_encounter"]
	):
		frappe.throw(_("Missing required details, did not create Inpatient Record"))

	inpatient_record = frappe.new_doc("Inpatient Record")

	# Admission order details
	set_details_from_ip_order(inpatient_record, admission_order)

	# Patient details
	patient = frappe.get_doc("Patient", admission_order["patient"])
	inpatient_record.patient = patient.name
	inpatient_record.patient_name = patient.patient_name
	inpatient_record.gender = patient.sex
	inpatient_record.blood_group = patient.blood_group
	inpatient_record.dob = patient.dob
	inpatient_record.mobile = patient.mobile
	inpatient_record.email = patient.email
	inpatient_record.phone = patient.phone
	inpatient_record.scheduled_date = today()

	# Set encounter details
	encounter = frappe.get_doc("Patient Encounter", admission_order["admission_encounter"])
	if encounter and encounter.symptoms:  # Symptoms
		set_ip_child_records(inpatient_record, "chief_complaint", encounter.symptoms)

	if encounter and encounter.diagnosis:  # Diagnosis
		set_ip_child_records(inpatient_record, "diagnosis", encounter.diagnosis)

	if encounter and encounter.drug_prescription:  # Medication
		set_ip_child_records(inpatient_record, "drug_prescription", encounter.drug_prescription)

	if encounter and encounter.lab_test_prescription:  # Lab Tests
		set_ip_child_records(inpatient_record, "lab_test_prescription", encounter.lab_test_prescription)

	if encounter and encounter.procedure_prescription:  # Procedure Prescription
		set_ip_child_records(
			inpatient_record, "procedure_prescription", encounter.procedure_prescription
		)

	if encounter and encounter.therapies:  # Therapies
		inpatient_record.therapy_plan = encounter.therapy_plan
		set_ip_child_records(inpatient_record, "therapies", encounter.therapies)

	inpatient_record.status = "Admission Scheduled"
	inpatient_record.save(ignore_permissions=True)
	return inpatient_record.name


@frappe.whitelist()
def schedule_discharge(args):
	discharge_order = json.loads(args)
	inpatient_record_id = frappe.db.get_value(
		"Patient", discharge_order["patient"], "inpatient_record"
	)

	if inpatient_record_id:

		inpatient_record = frappe.get_doc("Inpatient Record", inpatient_record_id)
		check_out_inpatient(inpatient_record)
		set_details_from_ip_order(inpatient_record, discharge_order)
		inpatient_record.status = "Discharge Scheduled"
		inpatient_record.save(ignore_permissions=True)

		frappe.db.set_value(
			"Patient", discharge_order["patient"], "inpatient_status", inpatient_record.status
		)
		if inpatient_record.discharge_encounter:
			frappe.db.set_value(
				"Patient Encounter",
				inpatient_record.discharge_encounter,
				"inpatient_status",
				inpatient_record.status,
			)

		if inpatient_record.discharge_nursing_checklist_template:
			NursingTask.create_nursing_tasks_from_template(
				inpatient_record.discharge_nursing_checklist_template,
				inpatient_record,
				start_time=now_datetime(),
			)


def set_details_from_ip_order(inpatient_record, ip_order):
	for key in ip_order:
		inpatient_record.set(key, ip_order[key])


def set_ip_child_records(inpatient_record, inpatient_record_child, encounter_child):
	for item in encounter_child:
		table = inpatient_record.append(inpatient_record_child)
		for df in table.meta.get("fields"):
			table.set(df.fieldname, item.get(df.fieldname))


def check_out_inpatient(inpatient_record):
	if inpatient_record.inpatient_occupancies:
		for inpatient_occupancy in inpatient_record.inpatient_occupancies:
			if inpatient_occupancy.left != 1:
				inpatient_occupancy.left = True
				inpatient_occupancy.check_out = now_datetime()
				frappe.db.set_value(
					"Healthcare Service Unit", inpatient_occupancy.service_unit, "occupancy_status", "Vacant"
				)


def discharge_patient(inpatient_record):
	validate_nursing_tasks(inpatient_record)

	validate_inpatient_invoicing(inpatient_record)

	validate_incompleted_service_requests(inpatient_record)

	inpatient_record.discharge_datetime = now_datetime()
	inpatient_record.status = "Discharged"

	inpatient_record.save(ignore_permissions=True)


def validate_inpatient_invoicing(inpatient_record):
	if frappe.db.get_single_value("Healthcare Settings", "allow_discharge_despite_unbilled_services"):
		return

	pending_invoices = get_pending_invoices(inpatient_record)

	if pending_invoices:
		message = _("Cannot mark Inpatient Record as Discharged since there are unbilled services. ")

		formatted_doc_rows = ""

		for doctype, docnames in pending_invoices.items():
			formatted_doc_rows += """
				<td>{0}</td>
				<td>{1}</td>
			</tr>""".format(
				doctype, docnames
			)

		message += """
			<table class='table'>
				<thead>
					<th>{0}</th>
					<th>{1}</th>
				</thead>
				{2}
			</table>
		""".format(
			_("Healthcare Service"), _("Documents"), formatted_doc_rows
		)

		frappe.throw(message, title=_("Unbilled Services"), is_minimizable=True, wide=True)


def get_pending_invoices(inpatient_record):
	pending_invoices = {}
	if not frappe.db.get_single_value("Healthcare Settings", "automatically_generate_billable"):
		if inpatient_record.inpatient_occupancies:
			service_unit_names = False
			for inpatient_occupancy in inpatient_record.inpatient_occupancies:
				if not inpatient_occupancy.invoiced:
					if is_service_unit_billable(inpatient_occupancy.service_unit):
						if service_unit_names:
							service_unit_names += ", " + inpatient_occupancy.service_unit
						else:
							service_unit_names = inpatient_occupancy.service_unit
			if service_unit_names:
				pending_invoices["Inpatient Occupancy"] = service_unit_names
	else:
		if inpatient_record.items:
			service_unit_names = False
			for item in inpatient_record.items:
				if not item.invoiced:
					if service_unit_names:
						service_unit_names += ", " + item.item_code
					else:
						service_unit_names = item.item_code
			if service_unit_names:
				pending_invoices["Items"] = service_unit_names

	docs = ["Patient Appointment", "Patient Encounter", "Lab Test", "Clinical Procedure"]

	for doc in docs:
		doc_name_list = get_unbilled_inpatient_docs(doc, inpatient_record)
		if doc_name_list:
			pending_invoices = get_pending_doc(doc, doc_name_list, pending_invoices)

	return pending_invoices


def get_pending_doc(doc, doc_name_list, pending_invoices):
	if doc_name_list:
		doc_ids = False
		for doc_name in doc_name_list:
			doc_link = get_link_to_form(doc, doc_name.name)
			if doc_ids:
				doc_ids += ", " + doc_link
			else:
				doc_ids = doc_link
		if doc_ids:
			pending_invoices[doc] = doc_ids

	return pending_invoices


def get_unbilled_inpatient_docs(doc, inpatient_record):
	filters = {
		"patient": inpatient_record.patient,
		"inpatient_record": inpatient_record.name,
		"docstatus": 1,
	}
	if doc in ["Service Request", "Medication Request"]:
		filters.update(
			{
				"billing_status": "Pending",
			}
		)
	else:
		if doc == "Patient Encounter":
			filters.update(
				{
					"appointment": "",
				}
			)
		else:
			del filters["docstatus"]
		filters.update(
			{
				"invoiced": 0,
			}
		)
	if doc in ["Lab Test", "Clinical Procedure"]:
		filters.update(
			{
				"service_request": "",
			}
		)
	return frappe.db.get_list(doc, filters=filters)


def admit_patient(
	inpatient_record, service_unit, check_in, expected_discharge=None, currency=None, price_list=None
):
	validate_nursing_tasks(inpatient_record)

	inpatient_record.admitted_datetime = check_in
	inpatient_record.status = "Admitted"
	inpatient_record.expected_discharge = expected_discharge
	inpatient_record.currency = currency
	inpatient_record.price_list = price_list

	inpatient_record.set("inpatient_occupancies", [])
	transfer_patient(inpatient_record, service_unit, check_in)

	frappe.db.set_value(
		"Patient",
		inpatient_record.patient,
		{"inpatient_status": "Admitted", "inpatient_record": inpatient_record.name},
	)


def transfer_patient(inpatient_record, service_unit, check_in, txred=0):
	if any(
		(inpat_occup.service_unit == service_unit and inpat_occup.left == 0)
		for inpat_occup in inpatient_record.inpatient_occupancies
	):
		return

	item_line = inpatient_record.append("inpatient_occupancies", {})
	item_line.service_unit = service_unit
	item_line.check_in = check_in

	if txred:
		item_line.transferred_for_procedure = 1
	else:
		for inpat_occup in inpatient_record.inpatient_occupancies:
			if inpat_occup.transferred_for_procedure == 0 and inpat_occup.left == 0:
				inpat_occup.left = 1

	inpatient_record.save(ignore_permissions=True)

	frappe.db.set_value("Healthcare Service Unit", service_unit, "occupancy_status", "Occupied")


def patient_leave_service_unit(inpatient_record, check_out, leave_from):
	if inpatient_record.inpatient_occupancies:
		for inpatient_occupancy in inpatient_record.inpatient_occupancies:
			if inpatient_occupancy.left != 1 and inpatient_occupancy.service_unit == leave_from:
				inpatient_occupancy.left = True
				inpatient_occupancy.check_out = check_out
				frappe.db.set_value(
					"Healthcare Service Unit", inpatient_occupancy.service_unit, "occupancy_status", "Vacant"
				)
	inpatient_record.save(ignore_permissions=True)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_leave_from(doctype, txt, searchfield, start, page_len, filters):
	docname = filters["docname"]

	query = """select io.service_unit
		from `tabInpatient Occupancy` io, `tabInpatient Record` ir
		where io.parent = '{docname}' and io.parentfield = 'inpatient_occupancies'
		and io.left!=1 and io.parent = ir.name"""

	return frappe.db.sql(
		query.format(
			**{"docname": docname, "searchfield": searchfield, "mcond": get_match_cond(doctype)}
		),
		{"txt": "%%%s%%" % txt, "_txt": txt.replace("%", ""), "start": start, "page_len": page_len},
	)


def is_service_unit_billable(service_unit):
	service_unit_doc = frappe.qb.DocType("Healthcare Service Unit")
	service_unit_type = frappe.qb.DocType("Healthcare Service Unit Type")
	result = (
		frappe.qb.from_(service_unit_doc)
		.left_join(service_unit_type)
		.on(service_unit_doc.service_unit_type == service_unit_type.name)
		.select(service_unit_type.is_billable)
		.where(service_unit_doc.name == service_unit)
	).run(as_dict=1)
	return result[0].get("is_billable", 0)


@frappe.whitelist()
def set_ip_order_cancelled(inpatient_record, reason, encounter=None):
	inpatient_record = frappe.get_doc("Inpatient Record", inpatient_record)
	if inpatient_record.status == "Admission Scheduled":
		inpatient_record.status = "Cancelled"
		inpatient_record.reason_for_cancellation = reason
		inpatient_record.save(ignore_permissions=True)
		encounter_name = encounter if encounter else inpatient_record.admission_encounter
		if encounter_name:
			frappe.db.set_value(
				"Patient Encounter", encounter_name, {"inpatient_status": None, "inpatient_record": None}
			)


@frappe.whitelist()
def cancel_amend_treatment_counselling(args, treatment_counselling):
	if isinstance(args, str):
		args = json.loads(args)
	tpc_doc = frappe.get_doc("Treatment Counselling", treatment_counselling)
	tpc_doc.flags.ignore_validate = True
	tpc_doc.cancel()
	args["amended_from"] = treatment_counselling
	create_treatment_counselling(args)


@frappe.whitelist()
def make_discharge_summary(source_name, target_doc=None, ignore_permissions=False):
	doclist = get_mapped_doc(
		"Inpatient Record",
		source_name,
		{
			"Inpatient Record": {
				"doctype": "Discharge Summary",
				"field_map": {
					"name": "inpatient_record",
				},
				"field_no_map": ["status", "chief_complaint", "diagnosis"],
			},
		},
		target_doc,
	)

	return doclist


@frappe.whitelist()
def create_treatment_counselling(ip_order):
	if isinstance(ip_order, str):
		ip_order = json.loads(ip_order)
	financial_counselling = frappe.new_doc("Treatment Counselling")
	set_details_from_ip_order(financial_counselling, ip_order)
	financial_counselling.encounter_status = "Admission Scheduled"
	financial_counselling.status = "Active"
	financial_counselling.save(ignore_permissions=True)


@frappe.whitelist()
def create_stock_entry(items, inpatient_record):
	items = json.loads(items)
	ip_record_doc = frappe.get_doc("Inpatient Record", inpatient_record)
	stock_entry = frappe.new_doc("Stock Entry")

	stock_entry.stock_entry_type = "Material Issue"
	stock_entry.to_warehouse = ip_record_doc.warehouse
	stock_entry.company = ip_record_doc.company
	expense_account = get_account(
		None, "expense_account", "Healthcare Settings", ip_record_doc.company
	)
	for item in items:
		se_child = stock_entry.append("items")
		se_child.item_code = item.get("item_code")
		se_child.uom = item.get("uom")
		se_child.qty = item.get("quantity")
		se_child.s_warehouse = ip_record_doc.warehouse
		cost_center = frappe.get_cached_value("Company", ip_record_doc.company, "cost_center")
		se_child.cost_center = cost_center
		se_child.expense_account = expense_account
	stock_entry.save().submit()

	return stock_entry.name


def set_item_rate(doc):
	from erpnext.stock.get_item_details import get_item_details

	price_list, price_list_currency = frappe.db.get_values(
		"Price List", {"selling": 1}, ["name", "currency"]
	)[0]
	total_amount = 0
	for item in doc.items:
		if not item.rate:
			args = {
				"doctype": "Sales Invoice",
				"item_code": item.get("item_code"),
				"company": doc.company,
				"customer": frappe.db.get_value("Patient", doc.patient, "customer"),
				"selling_price_list": doc.price_list or price_list,
				"price_list_currency": doc.currency or price_list_currency,
				"plc_conversion_rate": 1.0,
				"conversion_rate": 1.0,
			}
			item_details = get_item_details(args)
			item.rate = item_details.get("price_list_rate")
			item.amount = item.rate * item.quantity

		item.amount = item.rate * item.quantity
		# if item.amount:
		# 	total_amount += item.amount


def add_occupied_service_unit_in_ip_to_billables():
	if not frappe.db.get_single_value("Healthcare Settings", "automatically_generate_billable"):
		return

	inpatient_records = frappe.get_all(
		"Inpatient Record", {"status": ("in", ["Admitted", "Discharge Scheduled"])}
	)

	for inpatient_record in inpatient_records:
		frappe.get_doc(
			"Inpatient Record", inpatient_record.name
		).add_service_unit_rent_to_billable_items()


def set_total(self):
	total = 0
	if self.items:
		for p in self.items:
			if p.get("amount"):
				total += p.get("amount")
	self.total = total


def validate_incompleted_service_requests(inpatient_record):
	if not frappe.db.get_single_value(
		"Healthcare Settings", "allow_discharge_despite_pending_healthcare_services"
	):
		return

	filters = {
		"patient": inpatient_record.patient,
		"inpatient_record": inpatient_record.name,
		"docstatus": 1,
		"status": ["not in", ["Completed"]],
	}

	service_requests = frappe.db.get_list("Service Request", filters=filters, pluck="name")
	if service_requests and len(service_requests) > 0:
		service_requests = [
			get_link_to_form("Service Request", service_request) for service_request in service_requests
		]
		service_request_list = ", ".join(str(request) for request in service_requests)
		message = _("There are Orders yet to be carried out<b> {0}").format(
			frappe.bold(service_request_list)
		)

		frappe.throw(message, title=_("Incomplete Services"), is_minimizable=True, wide=True)


def insert_pending_service_request(doc):
	treatment_counselling = frappe.db.exists(
		{"doctype": "Treatment Counselling", "inpatient_record": doc.name}
	)
	if treatment_counselling:
		counselling_doc = frappe.get_doc("Treatment Counselling", treatment_counselling)

		for treatment_items in counselling_doc.treatment_plan_template_items:
			if not treatment_items.service_request:
				template_doc = frappe.get_doc(treatment_items.type, treatment_items.template)
				order = frappe.get_doc(
					{
						"doctype": "Service Request",
						"order_date": today(),
						"order_time": now(),
						"company": doc.company,
						"status": "Draft",
						"patient": doc.get("patient"),
						"practitioner": doc.primary_practitioner,
						"source_doc": "Inpatient Record",
						"order_group": doc.name,
						"patient_care_type": template_doc.get("patient_care_type"),
						"staff_role": template_doc.get("staff_role"),
						"medical_code": template_doc.get("medical_code"),
						"medical_code_standard": template_doc.get("medical_code_standard"),
						"template_dt": treatment_items.get("type"),
						"template_dn": treatment_items.get("template"),
					}
				)
				order.insert(ignore_permissions=True, ignore_mandatory=True)
				order.submit()


def create_orders_from_treatment_counselling(doc):
	treatment_councelling = frappe.db.get_value(
		"Treatment Counselling", {"inpatient_record": doc.name, "status": "Completed"}, "name"
	)
	if not treatment_councelling:
		return
	tc_doc = frappe.get_doc("Treatment Counselling", treatment_councelling)
	create_orders = False
	for item in tc_doc.treatment_plan_template_items:
		if not item.service_request:
			if item.get("type") == "Medication":
				medication = frappe.get_doc("Medication", item.get("template"))
				order = get_order_details(tc_doc, medication, item, doc.name, True)
				order.insert(ignore_permissions=True, ignore_mandatory=True)
				order.submit()
				item.service_request = order.name
				create_orders = True

			elif item.get("type") in [
				"Observation Template",
				"Lab Test Template",
				"Therapy Type",
				"Clinical Procedure Template",
			]:
				lab_template = frappe.get_doc(item.get("type"), item.get("template"))
				order = get_order_details(tc_doc, lab_template, item, doc.name)
				order.insert(ignore_permissions=True, ignore_mandatory=True)
				order.submit()
				item.service_request = order.name
				create_orders = True
	tc_doc.save("Update")

	if create_orders:
		frappe.msgprint(
			_("Orders Created from Treatment Counselling"),
			alert=True,
		)


def get_order_details(doc, template_doc, line_item, ip_name, medication_request=False):
	order = frappe.get_doc(
		{
			"doctype": "Medication Request" if medication_request else "Service Request",
			"order_date": frappe.utils.nowdate(),
			"order_time": frappe.utils.nowtime(),
			"company": doc.company,
			"status": "draft-Medication Request Status" if medication_request else "draft-Request Status",
			"patient": doc.get("patient"),
			"practitioner": doc.primary_practitioner,
			"source_doc": "Inpatient Record",
			"order_group": doc.admission_encounter if medication_request else ip_name,
			"sequence": line_item.get("sequence"),
			"patient_care_type": template_doc.get("patient_care_type"),
			"intent": line_item.get("intent"),
			"priority": line_item.get("priority"),
			"quantity": line_item.get_quantity() if line_item.get("doctype") == "Drug Prescription" else 1,
			"dosage": line_item.get("dosage"),
			"dosage_form": line_item.get("dosage_form"),
			"period": line_item.get("period"),
			"expected_date": line_item.get("expected_date"),
			"as_needed": line_item.get("as_needed"),
			"staff_role": template_doc.get("staff_role"),
			"note": line_item.get("note"),
			"patient_instruction": line_item.get("patient_instruction"),
			"medical_code": template_doc.get("medical_code"),
			"medical_code_standard": template_doc.get("medical_code_standard"),
		}
	)

	if not line_item.get("description"):
		if template_doc.doctype == "Lab Test Template":
			description = template_doc.get("lab_test_description")
		else:
			description = template_doc.get("description")
	else:
		description = line_item.get("description")

	if template_doc.doctype == "Clinical Procedure Template":
		order.update(
			{
				"referred_to_practitioner": line_item.get("practitioner"),
				"ordered_for": line_item.get("date"),
			}
		)
	elif template_doc.doctype == "Healthcare Activity":
		order.update(
			{
				"repeat_in_every": line_item.get("repeat_in_every"),
			}
		)
	if medication_request:
		order.update(
			{
				"source_dt": "Inpatient Record",
				"medication": template_doc.name,
				"number_of_repeats_allowed": line_item.get("number_of_repeats_allowed"),
				"medication_item": line_item.get("drug_code") if line_item.get("drug_code") else "",
				"healthcare_activity": line_item.get("healthcare_activity")
				if line_item.get("healthcare_activity")
				else "",
			}
		)
	else:
		order.update({"template_dt": template_doc.doctype, "template_dn": template_doc.name})

	order.update({"order_description": description})

	return order
