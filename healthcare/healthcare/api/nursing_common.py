# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import now_datetime

import erpnext

# An admission in any of these states still has the patient on a ward.
IN_HOSPITAL_STATUSES = ("Admitted", "Discharge Scheduled")


def has_value(value):
	return value is not None and str(value).strip() != ""


def default_company():
	company = frappe.defaults.get_user_default("Company") or erpnext.get_default_company()
	if company:
		return company

	companies = frappe.get_all("Company", pluck="name", limit=1)
	return companies[0] if companies else None


def admitted_patients():
	"""A patient pending discharge is still in a bed and still needs nursing care."""
	return frappe.get_all(
		"Inpatient Record",
		filters={"status": ["in", IN_HOSPITAL_STATUSES]},
		pluck="patient",
	)


class ChartAccess:
	"""What the caller may do to a patient's chart.

	The nursing endpoints take the patient and the record an entry is filed
	under from the caller, so nothing about the request itself proves the
	caller should be there. Every endpoint passes through here first: the
	role must allow the document, the user must be allowed the patient, and
	the record the entry is filed under must be that patient's own.
	"""

	def __init__(self, patient, reference_doctype=None, reference_name=None):
		self.patient = patient
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name

	def to_read(self):
		if not self.patient:
			frappe.throw(_("Choose a patient"))
		frappe.has_permission("Patient", "read", self.patient, throw=True)
		self.check_reference()
		self.check_ward()
		return self

	def check_ward(self):
		if WardScope().allows(self.patient, self.reference_doctype, self.reference_name):
			return
		frappe.throw(
			_("{0} is not in a unit you are assigned to").format(frappe.bold(self.patient)),
			frappe.PermissionError,
		)

	def to_write(self, doctype):
		frappe.has_permission(doctype, "create", throw=True)
		return self.to_read()

	def check_reference(self):
		if not self.reference_doctype and not self.reference_name:
			return
		if not (self.reference_doctype and self.reference_name):
			frappe.throw(_("Both the reference document type and name are needed"))

		if not self.names_a_patient():
			frappe.throw(_("A chart entry cannot be filed under {0}").format(_(self.reference_doctype)))

		frappe.has_permission(self.reference_doctype, "read", self.reference_name, throw=True)
		if self.reference_patient() != self.patient:
			frappe.throw(
				_("{0} {1} does not belong to this patient").format(
					_(self.reference_doctype), frappe.bold(self.reference_name)
				),
				frappe.PermissionError,
			)

	def names_a_patient(self):
		"""Only a document that says whose it is can be checked against the patient."""
		if self.reference_doctype == "Patient":
			return True
		return frappe.get_meta(self.reference_doctype).has_field("patient")

	def reference_patient(self):
		"""An entry filed under the patient record itself is filed under that patient."""
		if self.reference_doctype == "Patient":
			return self.reference_name
		return frappe.db.get_value(self.reference_doctype, self.reference_name, "patient")


def editable(doctype, name):
	"""A chart document the caller is allowed to change."""
	document = frappe.get_doc(doctype, name)
	document.check_permission("write")
	ChartAccess(document.patient).to_read()
	return document


class Lapse:
	"""Marks what was left waiting too long as Missed.

	A nurse may act on a row between our reading it and our writing it, so the
	write is conditional: the status test is part of the UPDATE, and a row that
	has moved on since the read is left as the nurse set it.
	"""

	def __init__(self, doctype, waiting_statuses, filters):
		self.doctype = doctype
		self.waiting_statuses = waiting_statuses
		self.filters = filters

	def run(self):
		waiting = frappe.get_all(self.doctype, filters=self.filters, pluck="name")
		if not waiting:
			return []

		self.mark_missed(waiting)
		return frappe.get_all(
			self.doctype, filters={"name": ["in", waiting], "status": "Missed"}, pluck="name"
		)

	def mark_missed(self, names):
		table = frappe.qb.DocType(self.doctype)
		(
			frappe.qb.update(table)
			.set(table.status, "Missed")
			.set(table.modified, now_datetime())
			.set(table.modified_by, frappe.session.user)
			.where(table.name.isin(names) & table.status.isin(self.waiting_statuses))
			.run()
		)


class WardScope:
	"""Which patients a user may chart, when they are assigned to wards.

	Frappe scopes a user to patients through User Permissions on Patient.
	A ward nurse is scoped through User Permissions on Healthcare Service
	Unit instead: naming a ward (or a bed) means they may chart only the
	patients in it, or in a unit beneath it, right now. A user with no unit
	permissions is not ward-scoped, which is what an unset User Permission
	means everywhere else in Frappe.
	"""

	OPEN_EMERGENCY = ("Registered", "Triaged", "In Treatment", "Awaiting Disposition")

	def __init__(self, user=None):
		self.user = user or frappe.session.user

	def restricted(self):
		return bool(self.assigned_units())

	def assigned_units(self):
		from frappe.core.doctype.user_permission.user_permission import get_permitted_documents

		return get_permitted_documents("Healthcare Service Unit")

	def units(self):
		"""The assigned units and everything beneath them, so a ward covers its beds."""
		from frappe.utils.nestedset import get_descendants_of

		units = set(self.assigned_units())
		for unit in list(units):
			units.update(get_descendants_of("Healthcare Service Unit", unit, ignore_permissions=True))
		return units

	def allows(self, patient, reference_doctype=None, reference_name=None):
		if not self.restricted():
			return True

		units = self.units()
		if self.current_unit_of(patient) in units:
			return True
		return self.unit_of(reference_doctype, reference_name) in units

	def current_unit_of(self, patient):
		"""The bed of an open admission, else the bay of an open emergency visit."""
		occupancy = frappe.get_all(
			"Inpatient Occupancy",
			filters={"parent": frappe.db.get_value("Patient", patient, "inpatient_record"), "left": 0},
			pluck="service_unit",
			order_by="idx desc",
			limit=1,
		)
		if occupancy:
			return occupancy[0]

		visit = frappe.get_all(
			"Emergency Record",
			filters={"patient": patient, "status": ["in", self.OPEN_EMERGENCY], "docstatus": ["<", 2]},
			pluck="service_unit",
			limit=1,
		)
		return visit[0] if visit else None

	def unit_of(self, reference_doctype, reference_name):
		"""A procedure or therapy names the unit it happens in."""
		if not (reference_doctype and reference_name):
			return None
		if not frappe.get_meta(reference_doctype).has_field("service_unit"):
			return None
		return frappe.db.get_value(reference_doctype, reference_name, "service_unit")

	def patients(self):
		"""Everyone in the assigned units now, for narrowing a search."""
		units = list(self.units())
		admissions = frappe.get_all(
			"Inpatient Occupancy",
			filters={"service_unit": ["in", units], "left": 0},
			pluck="parent",
			distinct=True,
		)
		admitted = frappe.get_all("Inpatient Record", filters={"name": ["in", admissions]}, pluck="patient")
		visiting = frappe.get_all(
			"Emergency Record",
			filters={
				"service_unit": ["in", units],
				"status": ["in", self.OPEN_EMERGENCY],
				"docstatus": ["<", 2],
			},
			pluck="patient",
			distinct=True,
		)
		return set(admitted) | set(visiting)
