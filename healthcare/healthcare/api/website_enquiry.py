# Copyright (c) 2026, Abu Zahra Physical Therapy Center and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import now, validate_email_address

from healthcare.healthcare.api.website_errors import throw_validation

SOURCE_MAP = {
	"website-contact": ("Website Contact", "website-contact"),
	"website-medical-tourism": ("Website Medical Tourism", "website-medical-tourism"),
}


def _clean(value):
	return (value or "").strip()


def _ensure_utm_source(name, slug):
	existing = frappe.db.exists("UTM Source", name)
	if existing:
		return name
	doc = frappe.get_doc(
		{
			"doctype": "UTM Source",
			"name": name,
			"slug": slug,
			"description": name,
		}
	)
	doc.insert(ignore_permissions=True)
	return name


def _match_country(text):
	value = _clean(text)
	if not value:
		return ""
	if frappe.db.exists("Country", value):
		return value
	matched = frappe.db.get_value("Country", {"country_name": value}, "name")
	return matched or ""


def _match_language(code):
	value = _clean(code).lower()
	if value in {"en", "ar"} and frappe.db.exists("Language", value):
		return value
	return ""


def _email_allowed(email):
	if not email:
		return ""
	if not validate_email_address(email, throw=False):
		throw_validation("Please enter a valid email address.")
	if frappe.db.get_single_value("CRM Settings", "allow_lead_duplication_based_on_emails"):
		return email
	if frappe.db.exists("Lead", {"email_id": email}):
		return ""
	return email


def _build_note(payload, email_stored):
	lines = []
	notes = _clean(payload.get("notes"))
	if notes:
		lines.append(notes)
	country = _clean(payload.get("country"))
	if country:
		lines.append(_("Country") + f": {country}")
	condition = _clean(payload.get("condition"))
	if condition:
		lines.append(_("Condition") + f": {condition}")
	dates = _clean(payload.get("dates"))
	if dates:
		lines.append(_("Preferred dates") + f": {dates}")
	email = _clean(payload.get("email_id"))
	if email and email != email_stored:
		lines.append(_("Email") + f": {email}")
	return "\n".join(lines)


def _note_html(text):
	escaped = frappe.utils.escape_html(text).replace("\n", "<br>")
	return f"<p>{escaped}</p>"


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=60)
def create_enquiry(
	source=None,
	lead_name=None,
	mobile_no=None,
	email_id=None,
	notes=None,
	language=None,
	country=None,
	condition=None,
	dates=None,
):
	source_key = _clean(source)
	if source_key not in SOURCE_MAP:
		throw_validation("Unknown enquiry source.")

	full_name = _clean(lead_name)
	phone = _clean(mobile_no)
	if not full_name:
		throw_validation("Name is required.")
	if not phone:
		throw_validation("Phone is required.")

	utm_name, utm_slug = SOURCE_MAP[source_key]
	utm_source = _ensure_utm_source(utm_name, utm_slug)

	email = _clean(email_id)
	email_stored = _email_allowed(email)
	country_link = _match_country(country)
	language_link = _match_language(language)

	payload = {
		"notes": notes,
		"country": country,
		"condition": condition,
		"dates": dates,
		"email_id": email,
	}
	note_text = _build_note(payload, email_stored)

	lead_doc = {
		"doctype": "Lead",
		"first_name": full_name,
		"mobile_no": phone,
		"status": "Lead",
		"utm_source": utm_source,
	}
	if email_stored:
		lead_doc["email_id"] = email_stored
	if country_link:
		lead_doc["country"] = country_link
	if language_link:
		lead_doc["language"] = language_link
	condition_text = _clean(condition)
	if condition_text and frappe.get_meta("Lead").has_field("utm_content"):
		lead_doc["utm_content"] = condition_text[:140]
	if note_text:
		lead_doc["notes"] = [
			{
				"note": _note_html(note_text),
				"added_by": frappe.session.user if frappe.session.user != "Guest" else "Administrator",
				"added_on": now(),
			}
		]

	lead = frappe.get_doc(lead_doc)
	lead.insert(ignore_permissions=True)
	if note_text:
		lead.reload()
		lead.add_comment("Comment", text=_note_html(note_text))
	frappe.db.commit()

	return {
		"name": lead.name,
		"source": source_key,
		"status": lead.status or "Lead",
	}


DASHBOARD_STATUS = {
	"Lead": "new",
	"Open": "new",
	"Replied": "contacted",
	"Interested": "contacted",
	"Opportunity": "appointment",
	"Quotation": "appointment",
	"Lost Quotation": "appointment",
	"Converted": "patient",
	"Do Not Contact": "contacted",
}

WEBSITE_SOURCES = [name for name, _slug in SOURCE_MAP.values()]


def _plain_text(html):
	import re

	text = re.sub(r"<[^>]+>", " ", html or "")
	return " ".join(text.replace("&nbsp;", " ").split())


def _condition_from_note(html):
	text = _plain_text(html)
	for prefix in ("Condition:", "الحالة:"):
		if prefix in text:
			return text.split(prefix, 1)[1].strip().split(" Preferred")[0].strip()
	return ""


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=60)
def list_enquiries(limit=50):
	"""Website CRM overview: Contact and Medical Tourism Leads only."""
	try:
		limit = min(max(int(limit or 50), 1), 100)
	except (TypeError, ValueError):
		limit = 50

	fields = [
		"name",
		"lead_name",
		"first_name",
		"utm_source",
		"status",
		"creation",
		"country",
	]
	if frappe.get_meta("Lead").has_field("utm_content"):
		fields.append("utm_content")

	rows = frappe.get_all(
		"Lead",
		filters={"utm_source": ["in", WEBSITE_SOURCES]},
		fields=fields,
		order_by="creation desc",
		limit_page_length=limit,
		ignore_permissions=True,
	)
	if not rows:
		return []

	notes_by_parent = {}
	try:
		note_rows = frappe.get_all(
			"CRM Note",
			filters={"parent": ["in", [row.name for row in rows]], "parenttype": "Lead"},
			fields=["parent", "note"],
			ignore_permissions=True,
		)
		for note in note_rows:
			notes_by_parent.setdefault(note.parent, []).append(note.note or "")
	except Exception:
		notes_by_parent = {}

	enquiries = []
	for row in rows:
		condition = _clean(row.get("utm_content") if hasattr(row, "get") else getattr(row, "utm_content", ""))
		if not condition:
			for html in notes_by_parent.get(row.name, []):
				condition = _condition_from_note(html)
				if condition:
					break
		display_name = row.lead_name or row.first_name or ""
		enquiries.append(
			{
				"id": row.name,
				"name": display_name or row.name,
				"lead_name": display_name,
				"source": row.utm_source or "",
				"condition": condition,
				"branch": "",
				"creation": str(row.creation) if row.creation else "",
				"status": DASHBOARD_STATUS.get(row.status or "Lead", "new"),
				"erpnext_status": row.status or "Lead",
			}
		)
	return enquiries
