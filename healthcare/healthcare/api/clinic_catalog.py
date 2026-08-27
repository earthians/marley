# Copyright (c) 2026, Abu Zahra Physical Therapy Center and contributors
# For license information, please see license.txt

import frappe
from frappe.rate_limiter import rate_limit


def _as_options(rows, label_field):
	options = []
	for row in rows:
		label = row.get(label_field) or row.name
		options.append({"id": row.name, "label": label})
	return options


def _split_lines(value):
	if not value:
		return []
	items = []
	for line in str(value).replace("\r\n", "\n").split("\n"):
		item = line.strip().strip(",")
		if item:
			items.append(item)
	return items


def _file_url(path):
	if not path:
		return ""
	url = str(path).strip()
	if url.startswith("http://") or url.startswith("https://"):
		return url
	return url


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_doctors(specialty=None, branch=None):
	filters = {"status": "Active", "show_in_portal": 1}
	rows = frappe.get_all(
		"Healthcare Practitioner",
		filters=filters,
		fields=[
			"name",
			"practitioner_name",
			"image",
			"website_credentials",
			"website_role",
			"website_specialty",
			"website_bio",
			"website_languages",
			"website_certifications",
			"website_expertise",
			"website_branches",
		],
		order_by="practitioner_name asc",
		limit_page_length=0,
		ignore_permissions=True,
	)

	specialty_filter = (specialty or "").strip().lower()
	branch_filter = (branch or "").strip().lower()
	doctors = []
	for row in rows:
		branches = _split_lines(row.website_branches)
		specialty_value = (row.website_specialty or "").strip()
		if specialty_filter and specialty_value.lower() != specialty_filter:
			continue
		if branch_filter and not any(branch_filter == item.lower() for item in branches):
			# also allow substring match so "Mohandeseen" matches "Mohandeseen Branch"
			if not any(branch_filter in item.lower() or item.lower() in branch_filter for item in branches):
				continue
		doctors.append(
			{
				"id": row.name,
				"name": row.practitioner_name or row.name,
				"credentials": row.website_credentials or "",
				"role": row.website_role or "",
				"specialty": specialty_value,
				"bio": row.website_bio or "",
				"languages": _split_lines(row.website_languages),
				"certifications": _split_lines(row.website_certifications),
				"expertise": _split_lines(row.website_expertise),
				"branches": branches,
				"image": _file_url(row.image),
			}
		)
	return doctors


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_branches():
	rows = frappe.get_all(
		"Healthcare Service Unit",
		fields=["name", "healthcare_service_unit_name", "parent_healthcare_service_unit"],
		order_by="healthcare_service_unit_name asc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	bookable = [row for row in rows if row.parent_healthcare_service_unit]
	return _as_options(bookable, "healthcare_service_unit_name")


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_services():
	rows = frappe.get_all(
		"Therapy Type",
		filters={"disabled": 0},
		fields=["name", "therapy_type"],
		order_by="therapy_type asc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	return _as_options(rows, "therapy_type")


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_insurance_payors(category=None):
	filters = {"disabled": 0, "show_on_website": 1}
	category_filter = (category or "").strip().lower()
	if category_filter:
		filters["website_category"] = category_filter

	rows = frappe.get_all(
		"Insurance Payor",
		filters=filters,
		fields=["name", "insurance_payor_name", "website_category"],
		order_by="insurance_payor_name asc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	payors = []
	for row in rows:
		payors.append(
			{
				"id": row.name,
				"label": row.insurance_payor_name or row.name,
				"category": (row.website_category or "insurance").strip().lower() or "insurance",
			}
		)
	return payors
