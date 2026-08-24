#!/usr/bin/env python3
"""Idempotent site seed for website booking catalog.

Run from the bench directory:

    cd /home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd
    python ../Helper_codes/Seeding/seed_booking_catalog.py
"""

from pathlib import Path

BENCH_PATH = Path("/home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd")
SITE = "senlite.localhost"

BOOKING_CONDITIONS = [
	"Lumbar & Cervical Disc Prolapse",
	"Vertebral Spondylosis",
	"Sacroiliitis",
	"Post-Spinal Surgery Rehabilitation",
	"Spinal Stenosis",
	"Joint Arthritis",
	"Post-Fracture Joint Stiffness",
	"Ligament & Tendon Injuries",
	"Bell's Palsy",
	"Brachial Plexus Injury",
	"Nerve Inflammation",
	"Ataxia Rehabilitation",
	"Foot Drop",
	"Multiple Sclerosis (MS)",
	"Sciatica",
	"Carpal Tunnel Syndrome",
]

BOOKING_SERVICES = [
	"Electrotherapy",
	"Therapeutic Exercise",
	"Therapeutic Modalities",
	"Manual Therapy & Chiropractic",
]

BOOKING_BRANCHES = [
	"Mohandeseen Branch",
	"Sheikh Zayed Branch",
	"New Cairo (Diza) Branch",
]


def _item_code(label):
	raw = "".join(ch if ch.isalnum() else "-" for ch in label).strip("-")
	while "--" in raw:
		raw = raw.replace("--", "-")
	return (raw or "Therapy")[:140]


def _item_group():
	import frappe

	if frappe.db.exists("Item Group", "Services"):
		return "Services"
	return frappe.db.get_value("Item Group", {}, "name")


def _company():
	import frappe

	for name in ("AbuZahra PTC", "AbuZahra PTC"):
		if frappe.db.exists("Company", name):
			return name
	return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)


def _hsu_root(company):
	import frappe

	root = frappe.db.get_value(
		"Healthcare Service Unit",
		{"is_group": 1, "parent_healthcare_service_unit": "", "company": company},
		"name",
	)
	if root:
		return root
	return frappe.db.get_value(
		"Healthcare Service Unit",
		{"is_group": 1, "parent_healthcare_service_unit": ["in", ["", None]]},
		"name",
	)


def seed_booking_catalog():
	import frappe

	for label in BOOKING_CONDITIONS:
		if not frappe.db.exists("Complaint", {"complaints": label}):
			frappe.get_doc({"doctype": "Complaint", "complaints": label}).insert(ignore_permissions=True)

	item_group = _item_group()
	import healthcare.healthcare.doctype.therapy_type.therapy_type as therapy_type_module

	_orig_make_item_price = therapy_type_module.make_item_price

	def _safe_make_item_price(item, item_price):
		if frappe.db.exists("Item Price", {"item_code": item}):
			return
		try:
			_orig_make_item_price(item, item_price or 0)
		except Exception:
			frappe.clear_last_message()

	therapy_type_module.make_item_price = _safe_make_item_price
	try:
		for label in BOOKING_SERVICES:
			if frappe.db.exists("Therapy Type", {"therapy_type": label}):
				continue
			frappe.get_doc(
				{
					"doctype": "Therapy Type",
					"therapy_type": label,
					"item_code": _item_code(label),
					"item_name": label,
					"item_group": item_group,
					"is_billable": 0,
					"disabled": 0,
					"rate": 0,
				}
			).insert(ignore_permissions=True)
	finally:
		therapy_type_module.make_item_price = _orig_make_item_price

	company = _company()
	parent = _hsu_root(company)
	for label in BOOKING_BRANCHES:
		if frappe.db.exists("Healthcare Service Unit", {"healthcare_service_unit_name": label}):
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Healthcare Service Unit",
				"healthcare_service_unit_name": label,
				"is_group": 1,
				"company": company,
				"parent_healthcare_service_unit": parent,
			}
		)
		doc.insert(ignore_permissions=True)

	if not frappe.db.exists("Appointment Type", "Session Using TP Item"):
		frappe.get_doc(
			{
				"doctype": "Appointment Type",
				"appointment_type": "Session Using TP Item",
				"allow_booking_for": "Practitioner",
				"default_duration": 60,
			}
		).insert(ignore_permissions=True)

	if not frappe.db.exists("Healthcare Practitioner", {"status": "Active"}):
		gender = "Male" if frappe.db.exists("Gender", "Male") else frappe.db.get_value("Gender", {}, "name")
		frappe.get_doc(
			{
				"doctype": "Healthcare Practitioner",
				"naming_series": "HLC-PRAC-.YYYY.-",
				"first_name": "Abu Zahra",
				"last_name": "Clinic",
				"status": "Active",
				**({"gender": gender} if gender else {}),
			}
		).insert(ignore_permissions=True)

	frappe.db.commit()
	return {
		"conditions": len(BOOKING_CONDITIONS),
		"services": len(BOOKING_SERVICES),
		"branches": len(BOOKING_BRANCHES),
	}


def _connect():
	import os
	import sys

	os.chdir(BENCH_PATH)
	sys.path.insert(0, str(BENCH_PATH))
	import frappe

	frappe.init(site=SITE, sites_path=str(BENCH_PATH / "sites"))
	frappe.connect()
	return frappe


if __name__ == "__main__":
	frappe = _connect()
	try:
		result = seed_booking_catalog()
		print(result)
	finally:
		frappe.destroy()
