# Copyright (c) 2026, Abu Zahra Physical Therapy Center and contributors
# For license information, please see license.txt

import re

import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils import getdate, nowdate, validate_email_address

from healthcare.healthcare.api.website_errors import throw_server_error, throw_validation


def _clean(value):
	return (value or "").strip()


def _to_time(value):
	text = _clean(value)
	match = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$", text, re.I)
	if match:
		hours = int(match.group(1))
		minutes = match.group(2)
		seconds = match.group(3) or "00"
		period = match.group(4).upper()
		if period == "PM" and hours != 12:
			hours += 12
		if period == "AM" and hours == 12:
			hours = 0
		return f"{hours:02d}:{minutes}:{seconds}"
	if re.match(r"^\d{2}:\d{2}:\d{2}$", text):
		return text
	if re.match(r"^\d{1,2}:\d{2}$", text):
		hours, minutes = text.split(":")
		return f"{int(hours):02d}:{minutes}:00"
	return text


def _email_or_empty(email):
	value = _clean(email)
	if not value:
		return ""
	if not validate_email_address(value, throw=False):
		throw_validation("Please enter a valid email address.")
	return value


def _resolve_gender(sex):
	value = _clean(sex)
	if not value:
		throw_validation("Gender is required.")
	if frappe.db.exists("Gender", value):
		return value
	matched = frappe.db.get_value("Gender", {"gender": value}, "name")
	if matched:
		return matched
	throw_validation("Please choose Male or Female.")


def _default_company():
	company = (
		frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.defaults.get_global_default("company")
	)
	if company:
		return company
	row = frappe.get_all("Company", fields=["name"], limit=1)
	if row:
		return row[0].name
	throw_server_error("Clinic booking is not fully set up.")


def _first_appointment_type():
	preferred = frappe.db.get_value("Appointment Type", {"appointment_type": "Session Using TP Item"}, "name")
	if preferred:
		return preferred
	row = frappe.get_all("Appointment Type", fields=["name"], limit=1)
	if row:
		return row[0].name
	throw_server_error("Clinic booking is not fully set up.")


def _first_practitioner():
	row = frappe.get_all(
		"Healthcare Practitioner",
		filters={"status": "Active"},
		fields=["name"],
		order_by="practitioner_name asc",
		limit=1,
	)
	if row:
		return row[0].name
	throw_server_error("Clinic booking is not fully set up.")


def _find_patient(mobile):
	if not mobile:
		return None
	return frappe.db.get_value("Patient", {"mobile": mobile}, "name")


def _ensure_patient(payload):
	phone = _clean(payload.get("patient_phone"))
	existing = _find_patient(phone)
	if existing:
		return existing

	full_name = _clean(payload.get("patient_name"))
	parts = full_name.split()
	first_name = parts[0] if parts else full_name
	last_name = " ".join(parts[1:])
	gender = _resolve_gender(payload.get("patient_sex"))
	email = _email_or_empty(payload.get("patient_email"))

	doc = {
		"doctype": "Patient",
		"first_name": first_name,
		"last_name": last_name,
		"sex": gender,
		"mobile": phone,
		"invite_user": 0,
	}
	if email:
		doc["email"] = email
	patient = frappe.get_doc(doc)
	patient.insert(ignore_permissions=True)
	return patient.name


def _build_notes(payload):
	lines = [
		f"Source: {_clean(payload.get('source')) or 'website'}",
		f"Language: {_clean(payload.get('language'))}" if _clean(payload.get("language")) else "",
		f"Condition: {_clean(payload.get('condition'))}",
		f"Service: {_clean(payload.get('service'))}",
		f"Branch: {_clean(payload.get('branch'))}",
		f"Insurance: {_clean(payload.get('insurance_company'))}"
		if _clean(payload.get("insurance_company"))
		else "",
		f"Phone: {_clean(payload.get('patient_phone'))}",
		_clean(payload.get("notes")),
	]
	return "\n".join([line for line in lines if line])


def _validate_date(value):
	text = _clean(value)
	if not text:
		throw_validation("Appointment date is required.")
	try:
		day = getdate(text)
	except Exception:
		throw_validation("Appointment date is required.")
	if day.weekday() == 4:
		throw_validation("Friday is closed. Please choose another date.")
	if day < getdate(nowdate()):
		throw_validation("Please choose a date that is not in the past.")
	return day


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=60)
def create_appointment(
	patient_name=None,
	patient_phone=None,
	patient_sex=None,
	condition=None,
	service=None,
	branch=None,
	appointment_date=None,
	appointment_time=None,
	patient_email=None,
	insurance_company=None,
	notes=None,
	language=None,
	service_unit=None,
	source=None,
):
	payload = {
		"patient_name": patient_name,
		"patient_phone": patient_phone,
		"patient_sex": patient_sex,
		"condition": condition,
		"service": service,
		"branch": branch,
		"appointment_date": appointment_date,
		"appointment_time": appointment_time,
		"patient_email": patient_email,
		"insurance_company": insurance_company,
		"notes": notes,
		"language": language,
		"service_unit": service_unit,
		"source": source,
	}

	if not _clean(patient_name):
		throw_validation("Name is required.")
	if not _clean(patient_phone):
		throw_validation("Phone is required.")
	_resolve_gender(patient_sex)
	if not _clean(condition):
		throw_validation("Condition is required.")
	if not _clean(service):
		throw_validation("Service is required.")
	if not _clean(branch):
		throw_validation("Branch is required.")
	day = _validate_date(appointment_date)
	time_value = _to_time(appointment_time)
	if not time_value:
		throw_validation("Appointment time is required.")
	_email_or_empty(patient_email)

	try:
		appointment_type = _first_appointment_type()
		practitioner = _first_practitioner()
		company = _default_company()
		patient = _ensure_patient(payload)
		unit = _clean(service_unit)
		if unit and not frappe.db.exists("Healthcare Service Unit", unit):
			unit = ""

		appointment_doc = {
			"doctype": "Patient Appointment",
			"appointment_type": appointment_type,
			"practitioner": practitioner,
			"company": company,
			"appointment_date": day,
			"appointment_time": time_value,
			"duration": 60,
			"patient": patient,
			"notes": _build_notes(payload),
		}
		if unit:
			appointment_doc["service_unit"] = unit

		appointment = frappe.get_doc(appointment_doc)
		appointment.insert(ignore_permissions=True)
		frappe.db.commit()
	except frappe.ValidationError:
		raise
	except Exception:
		frappe.log_error(title="website_booking.create_appointment")
		throw_server_error("We could not complete this booking. Please try again.")

	return {
		"name": appointment.name,
		"status": appointment.status or "Scheduled",
		"appointment_datetime": appointment.appointment_datetime
		or f"{day} {time_value}",
		"practitioner": appointment.practitioner_name or appointment.practitioner or "Auto-assigned",
		"branch": _clean(branch),
		"patient_name": appointment.patient_name or _clean(patient_name),
	}
