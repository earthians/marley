# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from datetime import datetime
from math import ceil

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import flt, get_datetime, now_datetime, time_diff_in_hours, today

from healthcare.healthcare.doctype.observation.observation import (
	add_observation,
	record_observation_result,
)
from healthcare.healthcare.doctype.patient_insurance_coverage.patient_insurance_coverage import (
	make_insurance_coverage as generate_insurance_coverage,
)


class EmergencyRecord(Document):
	_DOCTYPE_NAME = "Emergency Record"

	def validate(self):
		self.set_patient_age()
		self.set_consultation_defaults()
		self.validate_occupancy_dates()
		self.update_patient_emergency_record()

	def before_insert(self):
		if not self.patient:
			self.patient = self.create_provisional_patient()

	def create_provisional_patient(self):
		patient = frappe.new_doc("Patient")
		patient.first_name = self.get("patient_description") or _("Unidentified Patient")
		patient.sex = self.get("gender") or "Other"
		patient.naming_series = "ER-.YYYY.-"
		patient.name = make_autoname("ER-.YYYY.-", "Patient", patient)
		patient.flags.name_set = True
		patient.insert(ignore_permissions=True)
		return patient.name

	def after_insert(self):
		if self.patient:
			frappe.db.set_value("Patient", self.patient, "emergency_record", self.name)

	@frappe.whitelist()
	def merge_patient(self, target_patient: str) -> str:
		if not self.patient:
			frappe.throw(_("There is no patient to merge"))
		if target_patient == self.patient:
			frappe.throw(_("Select a different Patient to merge into"))
		frappe.rename_doc("Patient", self.patient, target_patient, merge=True)
		if self.status not in ("Closed", "Cancelled"):
			frappe.db.set_value("Patient", target_patient, "emergency_record", self.name)
		return target_patient

	def update_patient_emergency_record(self):
		if self.patient and self.status in ("Closed", "Cancelled"):
			if frappe.db.get_value("Patient", self.patient, "emergency_record") == self.name:
				frappe.db.set_value("Patient", self.patient, "emergency_record", None)

	def set_patient_age(self):
		if not self.patient:
			return
		age = frappe.get_cached_doc("Patient", self.patient).calculate_age()
		if age:
			self.patient_age = age.get("age_in_string")

	def set_consultation_defaults(self):
		if not self.attending_practitioner:
			return
		practitioner = frappe.get_cached_doc("Healthcare Practitioner", self.attending_practitioner)
		if not self.get("consultation_item"):
			self.consultation_item = practitioner.op_consulting_charge_item
		if not self.get("consultation_charge"):
			self.consultation_charge = practitioner.op_consulting_charge

	def validate_occupancy_dates(self):
		for entry in self.occupancies:
			if (
				entry.check_in
				and entry.check_out
				and get_datetime(entry.check_in) > get_datetime(entry.check_out)
			):
				frappe.throw(_("Row #{0}: Check Out cannot be before Check In").format(entry.idx))

	@frappe.whitelist()
	def record_triage(self, triage_level: str) -> None:
		self.triage_level = triage_level
		self.triage_datetime = now_datetime()
		if self.status == "Registered":
			self.status = "Triaged"
		self.save()

	@frappe.whitelist()
	def assign_bed(self, service_unit: str, check_in: datetime | str | None = None) -> None:
		self.occupy_service_unit(service_unit, check_in or now_datetime())
		self.service_unit = service_unit
		if self.status in ("Registered", "Triaged"):
			self.status = "In Treatment"
		self.save()

	@frappe.whitelist()
	def transfer_bed(self, service_unit: str, check_in: datetime | str | None = None) -> None:
		self.release_current_bed(now_datetime())
		self.assign_bed(service_unit, check_in)

	@frappe.whitelist()
	def release_bed(self) -> None:
		self.release_current_bed(now_datetime())
		self.service_unit = None
		self.save()

	def occupy_service_unit(self, service_unit, check_in):
		current_status = frappe.db.get_value(
			"Healthcare Service Unit", service_unit, "occupancy_status", for_update=True
		)
		if current_status != "Vacant":
			frappe.throw(
				_("Service Unit {0} is already occupied. Please choose a vacant one.").format(
					frappe.bold(service_unit)
				),
				title=_("Service Unit Occupied"),
			)
		self.append("occupancies", {"service_unit": service_unit, "check_in": check_in})
		frappe.db.set_value("Healthcare Service Unit", service_unit, "occupancy_status", "Occupied")

	def release_current_bed(self, check_out):
		for entry in self.occupancies:
			if not entry.left:
				entry.left = 1
				entry.check_out = check_out
				frappe.db.set_value(
					"Healthcare Service Unit", entry.service_unit, "occupancy_status", "Vacant"
				)

	@frappe.whitelist()
	def get_occupancy_billable_items(self) -> list[dict]:
		item_hours = {}
		for occupancy in self.occupancies:
			unit_type = get_billable_service_unit_type(occupancy.service_unit)
			if not unit_type:
				continue
			check_out = get_datetime(occupancy.check_out) if occupancy.check_out else now_datetime()
			hours = flt(time_diff_in_hours(check_out, get_datetime(occupancy.check_in)), 2)
			detail = item_hours.setdefault(
				unit_type.item,
				{"item": unit_type.item, "uom": unit_type.uom, "rate": unit_type.rate, "hours": 0},
			)
			detail["hours"] += hours
			detail["no_of_hours"] = unit_type.no_of_hours
			detail["minimum_billable_qty"] = unit_type.minimum_billable_qty

		items = []
		for detail in item_hours.values():
			qty = occupancy_qty(detail["hours"], detail["no_of_hours"], detail["minimum_billable_qty"])
			if qty > 0:
				items.append(
					{"item_code": detail["item"], "qty": qty, "rate": detail["rate"], "uom": detail["uom"]}
				)
		return items

	@frappe.whitelist()
	def add_vital_signs(self, vitals: list[dict] | str) -> list[dict]:
		vitals = json.loads(vitals) if isinstance(vitals, str) else vitals
		results = [self.create_vital_observation(vital) for vital in vitals]
		record_observation_result(json.dumps(results))
		return results

	def create_vital_observation(self, vital):
		template = frappe.get_cached_doc("Observation Template", vital.get("template"))
		observation = add_observation(
			patient=self.patient,
			template=template.name,
			data_type=template.permitted_data_type,
			doc=self.doctype,
			docname=self.name,
			practitioner=self.triage_practitioner or self.attending_practitioner,
			company=self.company,
		)
		return {"observation": observation, "result": vital.get("result")}

	@frappe.whitelist()
	def get_vital_signs(self) -> list[dict]:
		return frappe.get_all(
			"Observation",
			filters={
				"reference_doctype": self.doctype,
				"reference_docname": self.name,
				"observation_category": "Vital Signs",
				"status": ["!=", "Cancelled"],
			},
			fields=["observation_template", "result", "permitted_unit", "posting_date"],
			order_by="creation desc",
		)

	@frappe.whitelist()
	def set_disposition(self, disposition: str, notes: str | None = None) -> None:
		self.disposition = disposition
		self.disposition_notes = notes
		self.disposition_datetime = now_datetime()
		if disposition == "Admitted":
			self.admit_to_inpatient()
		self.release_current_bed(now_datetime())
		self.service_unit = None
		self.status = "Closed"
		self.save()

	def admit_to_inpatient(self):
		patient = frappe.get_doc("Patient", self.patient)
		record = frappe.new_doc("Inpatient Record")
		record.update(
			{
				"patient": patient.name,
				"patient_name": patient.patient_name,
				"gender": patient.sex,
				"blood_group": patient.blood_group,
				"dob": patient.dob,
				"mobile": patient.mobile,
				"email": patient.email,
				"phone": patient.phone,
				"primary_practitioner": self.attending_practitioner,
				"medical_department": self.medical_department,
				"company": self.company,
				"admission_instruction": self.chief_complaint,
				"scheduled_date": today(),
				"status": "Admission Scheduled",
			}
		)
		record.insert(ignore_permissions=True)
		self.inpatient_record = record.name

	@frappe.whitelist()
	def create_sales_invoice(self) -> str:
		if frappe.db.exists(
			"Sales Invoice Item",
			{"reference_dt": self.doctype, "reference_dn": self.name, "docstatus": ["<", 2]},
		):
			frappe.throw(_("A Sales Invoice already exists for this Emergency Record"))

		customer = frappe.db.get_value("Patient", self.patient, "customer")
		if not customer:
			frappe.throw(
				_("Please set a Customer for Patient {0} to raise an invoice").format(
					frappe.bold(self.patient)
				)
			)

		invoice = frappe.new_doc("Sales Invoice")
		invoice.patient = self.patient
		invoice.customer = customer
		invoice.company = self.company
		invoice.due_date = today()
		invoice.ref_practitioner = self.attending_practitioner
		self.append_billable_lines(invoice)

		if not invoice.items:
			frappe.throw(_("Nothing to invoice for this Emergency Record"))

		invoice.set_missing_values()
		invoice.insert(ignore_permissions=True)
		self.db_set("sales_invoice", invoice.name)
		return invoice.name

	def append_billable_lines(self, invoice):
		if self.consultation_item:
			invoice.append(
				"items",
				{
					"item_code": self.consultation_item,
					"qty": 1,
					"rate": self.consultation_charge or 0,
					"reference_dt": self.doctype,
					"reference_dn": self.name,
					"practitioner": self.attending_practitioner,
				},
			)
		for occupancy in self.occupancies:
			unit_type = get_billable_service_unit_type(occupancy.service_unit)
			if not unit_type:
				continue
			hours = self.occupancy_hours(occupancy)
			invoice.append(
				"items",
				{
					"item_code": unit_type.item,
					"qty": occupancy_qty(hours, unit_type.no_of_hours, unit_type.minimum_billable_qty),
					"rate": unit_type.rate or 0,
					"uom": unit_type.uom,
					"reference_dt": "Emergency Occupancy",
					"reference_dn": occupancy.name,
				},
			)

	def occupancy_hours(self, occupancy):
		check_out = get_datetime(occupancy.check_out) if occupancy.check_out else now_datetime()
		return flt(time_diff_in_hours(check_out, get_datetime(occupancy.check_in)), 2)

	@frappe.whitelist()
	def create_insurance_coverage(self) -> None:
		if not self.insurance_policy:
			frappe.throw(_("Please set an Insurance Policy to create coverage"))

		for occupancy in self.occupancies:
			if occupancy.insurance_coverage:
				continue
			unit_type = get_billable_service_unit_type(occupancy.service_unit)
			if not unit_type:
				continue
			qty = occupancy_qty(
				self.occupancy_hours(occupancy), unit_type.no_of_hours, unit_type.minimum_billable_qty
			)
			coverage = generate_insurance_coverage(
				patient=self.patient,
				policy=self.insurance_policy,
				company=self.company,
				template_dt="Healthcare Service Unit Type",
				template_dn=unit_type.name,
				item_code=unit_type.item,
				qty=qty,
			)
			if coverage and coverage.get("coverage"):
				occupancy.db_set("insurance_coverage", coverage.get("coverage"))
				occupancy.db_set("coverage_status", coverage.get("coverage_status"))


def occupancy_qty(hours, no_of_hours, minimum_billable_qty):
	blocks = ceil(hours / no_of_hours) if no_of_hours else hours
	return max(blocks, minimum_billable_qty or 0)


def get_billable_service_unit_type(service_unit):
	service_unit_type = frappe.db.get_value("Healthcare Service Unit", service_unit, "service_unit_type")
	if not service_unit_type:
		return None
	unit_type = frappe.get_cached_doc("Healthcare Service Unit Type", service_unit_type)
	if not unit_type.is_billable or not unit_type.item:
		return None
	return unit_type


@frappe.whitelist()
def get_active_triage(patient: str) -> dict | None:
	records = frappe.get_all(
		"Emergency Record",
		filters={"patient": patient, "status": ["not in", ["Closed", "Cancelled"]]},
		fields=["name", "triage_level"],
		order_by="arrival_datetime desc",
		limit=1,
	)
	if not records or not records[0].triage_level:
		return None

	color, code = frappe.db.get_value("Triage Level", records[0].triage_level, ["color", "code"]) or (
		None,
		None,
	)
	return {
		"emergency_record": records[0].name,
		"triage_level": records[0].triage_level,
		"color": color,
		"code": code,
	}
