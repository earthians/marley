# Copyright (c) 2015, ESS LLP and contributors
# For license information, please see license.txt

import datetime
import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_link_to_form, getdate


class FeeValidity(Document):
	def validate(self):
		self.update_status()

	def update_status(self):
		if getdate(self.valid_till) < getdate():
			self.status = "Expired"
		elif self.visited == self.max_visits:
			self.status = "Completed"
		else:
			self.status = "Active"


def get_visit_date(visit):
	if visit.doctype == "Patient Encounter":
		return getdate(visit.encounter_date)
	return getdate(visit.appointment_date)


def get_visit_department(visit):
	if visit.doctype == "Patient Encounter":
		return visit.medical_department


def is_visit_cancelled(visit):
	if visit.doctype == "Patient Encounter":
		return visit.docstatus == 2
	return visit.status == "Cancelled"


def is_inpatient_visit(visit):
	"""Inpatient visits are billed with the admission, they are not outpatient follow ups."""
	if visit.get("inpatient_record"):
		return True

	return bool(frappe.db.get_value("Patient", visit.patient, "inpatient_record"))


def is_free_follow_up_enabled(practitioner, doctype="Patient Appointment"):
	"""Free follow ups apply when enabled for the practitioner or in Healthcare Settings."""
	if not practitioner:
		return False

	if doctype == "Patient Encounter" and not frappe.db.get_single_value(
		"Healthcare Settings", "apply_free_follow_ups_on_encounters"
	):
		return False

	pract_enabled = frappe.get_cached_value("Healthcare Practitioner", practitioner, "enable_free_follow_ups")
	settings_enabled = frappe.db.get_single_value("Healthcare Settings", "enable_free_follow_ups")

	return bool(pract_enabled or settings_enabled)


def create_fee_validity(visit):
	if patient_has_validity(visit):
		return

	settings = frappe.get_single("Healthcare Settings")
	valid_days, max_visits = settings.valid_days, settings.max_visits
	# a visit always has a practitioner here, free follow ups are never enabled without one
	if frappe.get_cached_value("Healthcare Practitioner", visit.practitioner, "enable_free_follow_ups"):
		valid_days, max_visits = frappe.get_cached_value(
			"Healthcare Practitioner", visit.practitioner, ["valid_days", "max_visits"]
		)

	visit_date = get_visit_date(visit)

	fee_validity = frappe.new_doc("Fee Validity")
	fee_validity.practitioner = visit.practitioner
	fee_validity.patient = visit.patient
	fee_validity.medical_department = get_visit_department(visit)
	fee_validity.reference_dt = visit.doctype
	fee_validity.reference_dn = visit.name
	fee_validity.sales_invoice_ref = frappe.db.get_value(
		"Sales Invoice Item", {"reference_dt": visit.doctype, "reference_dn": visit.name}, "parent"
	)
	fee_validity.max_visits = max_visits or 1
	fee_validity.visited = 0
	fee_validity.start_date = visit_date
	fee_validity.valid_till = visit_date + datetime.timedelta(days=int(valid_days or 1))
	fee_validity.save(ignore_permissions=True)

	return fee_validity


def patient_has_validity(visit):
	"""A patient can hold only one active validity per practitioner at a time."""
	validity_exists = frappe.db.exists(
		"Fee Validity",
		{
			"practitioner": visit.practitioner,
			"patient": visit.patient,
			"status": "Active",
			"valid_till": [">=", get_visit_date(visit)],
		},
	)

	return validity_exists


@frappe.whitelist()
def check_fee_validity(visit, date=None, practitioner=None):
	if isinstance(visit, str):
		visit = frappe.get_doc(json.loads(visit))

	practitioner = practitioner if practitioner else visit.practitioner
	if not practitioner or is_inpatient_visit(visit):
		return

	# Check if free follow-ups are enabled
	if not is_free_follow_up_enabled(practitioner, visit.doctype):
		return

	date = getdate(date) if date else get_visit_date(visit)

	filters = {
		"practitioner": practitioner,
		"patient": visit.patient,
		"valid_till": (">=", date),
	}
	if not is_visit_cancelled(visit):
		filters["status"] = "Active"
	else:
		filters["reference_dt"] = visit.doctype
		filters["reference_dn"] = visit.name

	validity = frappe.db.exists(
		"Fee Validity",
		filters,
	)

	if validity:
		return frappe.get_doc("Fee Validity", validity)

	# Fallback for rescheduled visits
	if visit.get("__islocal"):
		return

	validity = (
		get_fee_validity(visit.get("name"), date, ignore_status=True, reference_dt=visit.doctype) or None
	)
	if validity and len(validity):
		return frappe.get_doc("Fee Validity", validity[0].get("name"))

	return


def manage_fee_validity(visit):
	if is_inpatient_visit(visit) or not is_free_follow_up_enabled(visit.practitioner, visit.doctype):
		return

	pract_enabled = frappe.db.get_value(
		"Healthcare Practitioner", visit.practitioner, "enable_free_follow_ups"
	)
	visit_date = get_visit_date(visit)

	# Update fee validity dates when rescheduling an invoiced visit
	invoiced_fee_validity = frappe.db.exists(
		"Fee Validity", {"reference_dt": visit.doctype, "reference_dn": visit.name}
	)
	if invoiced_fee_validity and visit.get("invoiced"):
		start_date = frappe.db.get_value("Fee Validity", invoiced_fee_validity, "start_date")
		if visit_date != start_date:
			valid_days = frappe.db.get_single_value("Healthcare Settings", "valid_days")
			if pract_enabled:
				valid_days = frappe.db.get_value("Healthcare Practitioner", visit.practitioner, "valid_days")
			frappe.db.set_value(
				"Fee Validity",
				invoiced_fee_validity,
				{
					"start_date": visit_date,
					"valid_till": visit_date + datetime.timedelta(days=int(valid_days or 1)),
				},
			)

	# Check for existing valid fee
	fee_validity = check_fee_validity(visit)

	if fee_validity:
		exists = frappe.db.exists(
			"Fee Validity Reference", {"reference_dt": visit.doctype, "reference_dn": visit.name}
		)
		if is_visit_cancelled(visit) and fee_validity.visited > 0:
			fee_validity.visited -= 1
			frappe.db.delete(
				"Fee Validity Reference", {"reference_dt": visit.doctype, "reference_dn": visit.name}
			)
		elif fee_validity.status != "Active":
			return
		elif visit.name != fee_validity.reference_dn and not exists:
			fee_validity.visited += 1
			fee_validity.append(
				"reference_visits", {"reference_dt": visit.doctype, "reference_dn": visit.name}
			)
			if visit_date < fee_validity.start_date:
				# the validity now serves a visit earlier than the one that opened it
				fee_validity.start_date = visit_date

		if not fee_validity.sales_invoice_ref:
			# an encounter is invoiced after the validity is created, unlike an appointment
			fee_validity.sales_invoice_ref = frappe.db.get_value(
				"Sales Invoice Item", {"reference_dt": visit.doctype, "reference_dn": visit.name}, "parent"
			)

		fee_validity.save(ignore_permissions=True)
	else:
		# remove visit from fee validity reference when rescheduling a visit to date not in fee validity
		free_visit_validity = frappe.db.get_value(
			"Fee Validity Reference", {"reference_dt": visit.doctype, "reference_dn": visit.name}, "parent"
		)
		if free_visit_validity:
			fee_validity = frappe.get_doc(
				"Fee Validity",
				free_visit_validity,
			)
			frappe.db.delete(
				"Fee Validity Reference", {"reference_dt": visit.doctype, "reference_dn": visit.name}
			)
			if fee_validity.visited > 0:
				fee_validity.visited -= 1
				fee_validity.save(ignore_permissions=True)

		fee_validity = create_fee_validity(visit)

	return fee_validity


def cancel_fee_validity(visit):
	"""Cancel the validity this visit opened, or give back the visit it consumed.

	The validity exists only because of the visit that opened it, so it goes with it. An
	encounter is invoiced after it is submitted, so its invoiced state says nothing here.
	"""
	fee_validity = frappe.db.get_value(
		"Fee Validity", {"reference_dt": visit.doctype, "reference_dn": visit.name}
	)
	if fee_validity:
		validate_free_visits_not_taken(fee_validity)
		frappe.db.set_value("Fee Validity", fee_validity, "status", "Cancelled")
		return

	return manage_fee_validity(visit)


def validate_fee_validity_cancellation(visit):
	"""A visit cannot be cancelled while free visits stand against the validity it opened.

	This runs before anything is written, so the cancellation is refused rather than rolled back.
	"""
	fee_validity = frappe.db.get_value(
		"Fee Validity", {"reference_dt": visit.doctype, "reference_dn": visit.name}
	)
	if fee_validity:
		validate_free_visits_not_taken(fee_validity)


def validate_free_visits_not_taken(fee_validity):
	"""Free visits already taken would be left without the validity that made them free"""
	free_visits = frappe.get_all(
		"Fee Validity Reference", {"parent": fee_validity}, ["reference_dt", "reference_dn"]
	)
	if not free_visits:
		return

	frappe.throw(
		_("Cannot cancel, {0} taken against Fee Validity {1}. Cancel {2} first.").format(
			frappe.bold(_("free visits")),
			get_link_to_form("Fee Validity", fee_validity),
			", ".join(get_link_to_form(visit.reference_dt, visit.reference_dn) for visit in free_visits),
		),
		title=_("Free Visits Taken"),
	)


@frappe.whitelist()
def get_fee_validity(reference_dn, date, ignore_status=False, reference_dt="Patient Appointment"):
	"""
	Get the fee validity details for the free visit
	:params reference_dn: Patient Appointment or Patient Encounter doc name
	:params date: Schedule date
	:params ignore_status: status will not filter in query
	:params reference_dt: Patient Appointment or Patient Encounter
	:return fee validity name and valid_till values of free visits
	"""

	if not reference_dn:
		return None

	visit_details = frappe.db.get_value(reference_dt, reference_dn, ["patient", "practitioner"], as_dict=True)

	if not visit_details:
		return None

	fee_validity = frappe.qb.DocType("Fee Validity")
	child = frappe.qb.DocType("Fee Validity Reference")

	query = (
		frappe.qb.from_(fee_validity)
		.inner_join(child)
		.on(fee_validity.name == child.parent)
		.select(fee_validity.name, fee_validity.valid_till)
		.where(fee_validity.valid_till >= date)
		.where(fee_validity.patient == visit_details.patient)
		.where(fee_validity.practitioner == visit_details.practitioner)
		.where(child.reference_dt == reference_dt)
		.where(child.reference_dn == reference_dn)
	)

	if not ignore_status:
		query = query.where(fee_validity.status == "Active")

	validity_details = query.run(as_dict=True)

	return validity_details if len(validity_details) else None


def update_validity_status():
	# update the status of fee validity daily
	validities = frappe.db.get_all("Fee Validity", {"status": ["not in", ["Expired", "Cancelled"]]})

	for fee_validity in validities:
		fee_validity_doc = frappe.get_doc("Fee Validity", fee_validity.name)
		fee_validity_doc.update_status()
		fee_validity_doc.save()
