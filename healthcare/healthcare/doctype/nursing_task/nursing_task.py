# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import json

import frappe
from erpnext import get_default_company
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_to_date, flt, get_datetime, getdate, now_datetime, time_diff_in_seconds
from six import string_types

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account


class NursingTask(Document):
	def before_insert(self):
		# set requested start / end
		self.set_task_schedule()

		self.title = "{} - {}".format(_(self.patient), _(self.activity))

		self.age = frappe.get_doc("Patient", self.patient).get_age()


	def validate(self):
		if self.status == "Requested":
			# auto submit if status is Requested
			self.docstatus = 1

	def on_submit(self):
		self.db_set("status", "Requested")
		frappe.db.set_value(self.service_doctype, self.service_name, "task_done_at", now_datetime())

	def on_cancel(self):
		if self.status == "Completed":
			frappe.throw(_("Not Allowed to cancel Nursing Task with status 'Completed'"))

		self.db_set("status", "Cancelled")

	def on_update_after_submit(self):
		if self.status == "Completed" and self.task_doctype and not self.task_document_name:
			frappe.throw(_("Not Allowed to 'Complete' Nursing Task without linking Task Document"))

		if self.status == "Draft":
			frappe.throw(_("Nursing Task cannot be 'Draft' after submission"))

		if self.status == "In Progress":
			if not self.task_start_time:
				self.db_set("task_start_time", now_datetime())

		elif self.status == "Completed":
			self.db_set(
				{
					"task_end_time": now_datetime(),
					"task_duration": time_diff_in_seconds(self.task_end_time, self.task_start_time),
				}
			)
			frappe.db.set_value(self.service_doctype, self.service_name, "status", "Completed")

		self.notify_update()

	def set_task_schedule(self):
		if not self.requested_start_time or (get_datetime(self.requested_start_time) < now_datetime()):
			self.requested_start_time = now_datetime()

		if not self.requested_end_time:
			if not self.duration:
				self.duration = frappe.db.get_value("Healthcare Activity", self.activity, "duration")
			self.requested_end_time = add_to_date(self.requested_start_time, seconds=self.duration)

		# set date based on requested_start_time
		self.date = getdate(self.requested_start_time)

	@classmethod
	def create_nursing_tasks_from_template(cls, template, doc, start_time=None, post_event=True):
		tasks = frappe.get_all(
			"Nursing Checklist Template Task",
			filters={"parent": template},
			fields=["*"],
		)

		start_time = start_time or now_datetime()
		NursingTask.create_nursing_tasks(tasks, doc, start_time, post_event)

	@classmethod
	def create_nursing_tasks(cls, tasks, doc, start_time, post_event=True):
		for task in tasks:
			medical_department = (
				doc.get("department") if doc.get("department") else doc.get("medical_department")
			)
			if doc.get("doctype") == "Inpatient Record":
				service_unit = (
					frappe.db.get_value("Inpatient Occupancy", {"parent": doc.name, "left": 0}, "service_unit"),
				)
			else:
				service_unit = (
					doc.get("service_unit") if doc.get("service_unit") else doc.get("healthcare_service_unit")
				)

			options = {
				"doctype": "Nursing Task",
				"status": "Requested",
				"company": doc.get("company", get_default_company()),
				"service_unit": service_unit,
				"medical_department": medical_department,
				"reference_doctype": doc.get("doctype"),
				"reference_name": doc.get("name"),
				"patient": doc.get("patient"),
				"activity": task.activity,
				"mandatory": task.mandatory,
				"duration": task.task_duration,
				"task_doctype": task.task_doctype,
			}

			if task.time_offset:
				time_offset = task.time_offset if not post_event else 0 - task.time_offset
				requested_start_time = add_to_date(start_time, seconds=time_offset)
			else:
				requested_start_time = start_time

			options.update({"requested_start_time": requested_start_time})

			options = {key: value for (key, value) in options.items() if value}
			frappe.get_doc(options).insert()

	@classmethod
	def cancel_nursing_tasks(cls, dt, dn):
		tasks = frappe.db.get_all(
			"Nursing Task",
			filters={
				"reference_doctype": dt,
				"reference_document": dn,
				"status": ["!=", "Completed", "Cancelled"],
			},
		)

		for task in tasks:
			frappe.get_doc("Nursing Task", task).cancel()


@frappe.whitelist()
def create_nursing_tasks_from_template(template, doc, start_time, post_event=True):
	if isinstance(doc, string_types):
		doc = json.loads(doc)

	start_time = start_time or now_datetime()
	NursingTask.create_nursing_tasks_from_template(template, doc, start_time, post_event)


@frappe.whitelist()
def create_nursing_tasks_from_medication_request(medication):
	if not medication:
		return

	medication_request = frappe.get_doc("Medication Request", medication)
	if medication_request.docstatus == 1 and medication_request.dosage and medication_request.period:
		period = frappe.db.get_value(
			"Prescription Duration", medication_request.period, "number"
		)
		settings = frappe.get_single("Healthcare Settings")

		if period >= frappe.db.count(
			"Nursing Task",
			{
				"docstatus": ["!=", 2],
				"activity": settings.default_medication_activity,
				"service_doctype": "Medication Request",
				"service_name": medication_request.name,
			},
		):
			dosage_strengths = frappe.db.get_all(
				"Dosage Strength",
				filters={
					"parent": medication_request.dosage,
					"parenttype": "Prescription Dosage",
					"parentfield": "dosage_strength",
					"strength_time": [">=", frappe.utils.nowtime()],
				},
				fields=["strength", "strength_time"],
				as_list=False,
			)

			for dose in dosage_strengths:
				exists = frappe.db.exists(
					"Nursing Task",
					{
						"service_doctype": "Medication Request",
						"service_name": medication_request.name,
						"date": getdate(),
						"company": medication_request.company,
						"patient": medication_request.patient,
						"requested_start_time": f"{getdate()} {dose.strength_time}",
						"activity": settings.default_medication_activity,
					},
				)
				if not exists:
					doc = frappe.new_doc("Nursing Task")
					doc.activity = settings.default_medication_activity
					doc.service_doctype = "Medication Request"
					doc.service_name = medication_request.name
					doc.medical_department = medication_request.medical_department
					doc.company = medication_request.company
					doc.patient = medication_request.patient
					doc.patient_name = medication_request.patient_name
					doc.gender = medication_request.patient_gender
					doc.patient_age = medication_request.patient_age_data
					doc.practitioner = medication_request.practitioner
					doc.reference_doctype = medication_request.source_dt
					doc.reference_name = medication_request.order_group
					doc.requested_start_time = f"{getdate()} {dose.strength_time}"
					doc.description = medication_request.order_description
					doc.save()

			if settings.default_pharmacy_warehouse and medication_request.inpatient_record:
				make_stock_entry_for_medication(medication_request, settings.default_pharmacy_warehouse)



def create_nursing_task_for_inpatient_record():
	inpatient_records = frappe.db.get_all("Inpatient Record", filters={"status": "Admitted"}, pluck="name")

	for record in inpatient_records:
		record_doc = frappe.get_doc("Inpatient Record", record)
		medication_requests = frappe.db.get_all("Medication Request", filters={
			"inpatient_record": record_doc.name,
			"patient": record_doc.patient
		}, pluck="name")

		for medication_request in medication_requests:
			create_nursing_tasks_from_medication_request(medication_request)


def make_stock_entry_for_medication(medication_request, pharmacy_warehouse=None):
	if not pharmacy_warehouse:
		return

	if medication_request.medication_item:
		to_warehouse = get_warehouse_from_service_unit(medication_request.inpatient_record)
		if not to_warehouse:
			return

		stock_entry = frappe.new_doc("Stock Entry")
		stock_entry.purpose = "Material Transfer"
		stock_entry.set_stock_entry_type()
		stock_entry.from_warehouse = pharmacy_warehouse
		stock_entry.to_warehouse = to_warehouse
		stock_entry.company = medication_request.company
		cost_center = frappe.get_cached_value("Company", medication_request.company, "cost_center")
		expense_account = get_account(None, "expense_account", "Healthcare Settings", medication_request.company)

		se_child = stock_entry.append("items")
		se_child.item_code = medication_request.medication_item
		se_child.item_name = frappe.db.get_value("Item", medication_request.medication_item, "stock_uom")
		se_child.uom = frappe.db.get_value("Item", medication_request.medication_item, "stock_uom")
		se_child.stock_uom = se_child.uom
		se_child.qty = get_item_qty_from_dosage(medication_request.dosage)
		se_child.s_warehouse = pharmacy_warehouse
		se_child.t_warehouse = to_warehouse
		se_child.to_inpatient_record = medication_request.inpatient_record
		# in stock uom
		se_child.conversion_factor = 1
		se_child.cost_center = cost_center
		se_child.expense_account = expense_account
		stock_entry.save()
		stock_entry.submit()


def get_item_qty_from_dosage(dosage):
	if not dosage:
		return 1

	qty = frappe.db.get_all(
		"Dosage Strength",
		filters={
			"parent": dosage,
			"parenttype": "Prescription Dosage",
			"parentfield": "dosage_strength",
			"strength_time": [">=", frappe.utils.nowtime()]
		},
		fields=["sum(strength) as qty"]
	)

	return qty[0].qty if qty else 1


def get_warehouse_from_service_unit(inpatient_record):
	if not inpatient_record:
		return
	warehouse = None
	print("\n\n\n\n11111", f"""
		select io.service_unit
		from `tabInpatient Occupancy` as io left join
			`tabHealthcare Service Unit` as su on su.name=io.service_unit
		where io.parent={frappe.db.escape(inpatient_record)} and
			io.left=0 and
			su.is_ot=0
	""")
	service_units = frappe.db.sql(f"""
		select io.service_unit
		from `tabInpatient Occupancy` as io left join
			`tabHealthcare Service Unit` as su on su.name=io.service_unit
		where io.parent={frappe.db.escape(inpatient_record)} and
			io.left=0 and
			su.is_ot=0
	""", as_dict=True)

	print("\n\n\n\nservice", service_units)
	if service_units:
		warehouse = frappe.db.get_value("Healthcare Service Unit", service_units[0].service_unit, "warehouse")
	if not warehouse:
		warehouse = frappe.db.get_single_value("Healthcare Settings", "default_service_unit_warehouse")

	return warehouse
