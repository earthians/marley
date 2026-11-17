# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr

from healthcare.healthcare.doctype.patient_visit.patient_visit import (
	get_prescription_dates,
)
from healthcare.api.patient_visit import update_patient_visit_status


class PatientMedicationOrder(Document):
	def before_insert(self):
		if not cint(self.new_system) and not getattr(frappe.flags, "in_import", False):
			self.new_system = 1

	def validate(self):
		self.validate_inpatient()
		self.validate_duplicate()
		self.validate_pink_reference_no()
		self.ensure_entry_healthcare_practitioners()
		self.set_total_orders()
		self.set_status()

	def ensure_entry_healthcare_practitioners(self):
		"""Copy parent doctor onto medication lines that have no line-level practitioner yet.

		On create/submit the header doctor is the prescribing doctor for every initial line.
		Lines added later keep their own healthcare_practitioner (set when adding).
		"""
		parent_hp = cstr(
			getattr(self, "practitioner", None) or getattr(self, "healthcare_practitioner", None) or ""
		).strip()
		for row in self.get("medication_orders") or []:
			if not hasattr(row, "healthcare_practitioner"):
				continue
			hp = cstr(getattr(row, "healthcare_practitioner", None) or "").strip()
			if not hp:
				if not parent_hp:
					continue
				hp = parent_hp
				row.healthcare_practitioner = hp
			if hasattr(row, "healthcare_practitioner_name"):
				row.healthcare_practitioner_name = (
					frappe.db.get_value("Healthcare Practitioner", hp, "practitioner_name") or hp
				)

	def on_submit(self):
		self.validate_inpatient()
		self.validate_pink_reference_no()
		self.set_status()
  
		#ACtivate after going live with medication orders
		# if self.care_context=="Patient Visit":
		# 	update_patient_visit_status(
		# 		visit_name=self.patient_encounter,
		# 		action="medication_ordered",
		# 		doc_name=self.name,
		# 	)

	def on_cancel(self):
		self.set_status()

	def validate_inpatient(self):
		pass
		# if not self.inpatient_record:
		# 	frappe.throw(_("No Inpatient Admission found against patient {0}").format(self.patient))

	def validate_pink_reference_no(self):
		"""Reference No is mandatory on pink medication lines for outpatient only.

		Inpatient prescriptions do not require a pink reference number.
		"""
		if cstr(getattr(self, "care_context", "") or "").strip() == "Inpatient Admission":
			return
		if getattr(self, "inpatient_record", None) and not getattr(self, "patient_encounter", None):
			return
		for row in self.get("medication_orders") or []:
			if not cint(getattr(row, "is_pink", 0)):
				continue
			if not cstr(getattr(row, "reference_no", "") or "").strip():
				drug_label = getattr(row, "drug_name", None) or getattr(row, "drug", None) or row.idx
				frappe.throw(
					_("Reference No is required for pink medication: {0}").format(drug_label),
					title=_("Missing Reference No"),
				)

	def validate_duplicate(self):
		# Allow creating a new order when the existing one is Completed
		# Only block if there's an active (non-cancelled, non-completed) order for this visit
		existing_mo = frappe.db.sql(
			"""
			SELECT name FROM `tabPatient Medication Order`
			WHERE patient_encounter = %(patient_encounter)s
				AND docstatus != 2
				AND (status IS NULL OR status != 'Completed')
				AND (name != %(name)s OR %(name)s IS NULL OR %(name)s = '')
			LIMIT 1
			""",
			{"patient_encounter": self.patient_encounter, "name": self.name or ""},
			as_dict=True,
		)
		# if existing_mo:
		# 	frappe.throw(
		# 		_("A Patient Medication Order {0} against Patient Visit {1} already exists.").format(
		# 			existing_mo[0].name, self.patient_encounter
		# 		),
		# 		frappe.DuplicateEntryError,
		# 	)

	def set_total_orders(self):
		self.total_orders = len(self.medication_orders)

	def _compute_status(self):
		has_signature = bool(cstr(self.doctors_signature).strip())
		is_pharmacy_giveout = bool(cint(getattr(self, "nursing_pharmacy_giveout", 0) or getattr(self, "is_pharmacy_give_out", 0)))

		if self.docstatus == 2:
			return "Cancelled"
		# Pharmacy give-out PMOs are fulfilled and billed immediately, so mark them complete
		# without waiting for prescription signature workflow.
		if is_pharmacy_giveout and self.docstatus == 1:
			if self.completed_orders and self.completed_orders < self.total_orders:
				return "In Process"
			return "Completed"
		if cint(self.new_system):
			if not has_signature:
				return "Unsigned"
			if self.docstatus == 1:
				if not self.completed_orders:
					return "Signed"
				if self.completed_orders < self.total_orders:
					return "In Process"
				return "Completed"
			return "Signed"
		if self.docstatus == 1:
			if not self.completed_orders:
				return "Pending"
			if self.completed_orders < self.total_orders:
				return "In Process"
			return "Completed"
		return "Signed" if has_signature else "Draft"

	def set_status(self):
		status = self._compute_status()
		self.status = status
		if self.name and self.docstatus == 1:
			frappe.db.set_value(
				self.doctype,
				self.name,
				"status",
				status,
				update_modified=False,
			)

	@staticmethod
	def allows_medicine_giving(doc) -> bool:
		"""New-system prescriptions require a doctor signature before medicine can be given."""
		if not cint(getattr(doc, "new_system", 0)):
			return True
		has_signature = bool(cstr(getattr(doc, "doctors_signature", "")).strip())
		status = cstr(getattr(doc, "status", "")).strip()
		return has_signature and status in ("Signed", "In Process", "Completed")

	@frappe.whitelist()
	def add_order_entries(self, order):
		if order.get("drug_code"):
			dosage = frappe.get_doc("Prescription Frequency", order.get("dosage"))
			dates = get_prescription_dates(order.get("period"), self.start_date)
			for date in dates:
				for dose in dosage.dosage_strength:
					entry = self.append("medication_orders")
					entry.drug = order.get("drug_code")
					entry.drug_name = frappe.db.get_value("Item", order.get("drug_code"), "item_name")
					entry.dosage = dose.strength
					entry.dosage_form = order.get("dosage_form")
					entry.date = date
					entry.time = dose.strength_time
			self.end_date = dates[-1]
		return

	@frappe.whitelist()
	def get_from_encounter(self, encounter):
		patient_encounter = frappe.get_doc("Patient Visit", encounter)
		if not patient_encounter.drug_prescription:
			return
		for drug in patient_encounter.drug_prescription:
			self.add_order_entries(drug)

	@frappe.whitelist()
	def create_subscription_plan(self, medications, frequency, start_date=None, end_date=None):
		"""Create a Subscription Medication Plan from this Medication Order.

		:medications: list of row dicts coming from the dialog Table
		"""
		if not medications:
			frappe.throw(_("Please add at least one medication"))

		start_date = start_date or self.start_date

		plan = frappe.new_doc("Subscription Medication Plan")
		plan.patient = self.patient
		plan.practitioner = self.practitioner
		plan.company = self.company
		plan.frequency = frequency
		plan.start_date = start_date
		plan.end_date = end_date
		plan.next_run_date = start_date

		for row in medications:
			if not row.get("drug"):
				continue
			child = plan.append("medications")
			# optional link back to original entry if provided
			child.medication_order_entry = row.get("medication_order_entry")
			child.drug = row.get("drug")
			child.drug_name = row.get("drug_name")
			child.dosage = row.get("dosage")
			child.uom = row.get("uom")
			if child.uom and not frappe.db.exists("UOM", child.uom):
				child.uom = None
			child.dosage_form = row.get("dosage_form")
			child.instructions = row.get("instructions")
			child.patient_frequency = row.get("patient_frequency")
			child.date = row.get("date")
			child.time = row.get("time")
			child.qty_per_cycle = row.get("qty_per_cycle") or 1
			child.is_active = row.get("is_active", 1)

		plan.insert()
		plan.submit()

		return {
			"name": plan.name,
			"patient": plan.patient,
			"next_run_date": plan.next_run_date,
		}
