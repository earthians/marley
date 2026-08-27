#!/usr/bin/env python3
"""Idempotent site seed for public website enquiry UTM sources.

Run from the bench directory:

    cd /home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd
    ./env/bin/python ../Helper_codes/Seeding/seed_website_enquiry.py
"""

from pathlib import Path
import sys

BENCH_PATH = Path("/home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd")
SITE = "senlite.localhost"

SOURCES = [
	("Website Contact", "website-contact", "Public website Contact form"),
	("Website Medical Tourism", "website-medical-tourism", "Public website Medical Tourism form"),
]


def seed_website_enquiry():
	import frappe

	created = 0
	updated = 0
	for name, slug, description in SOURCES:
		existing = frappe.db.exists("UTM Source", name) or frappe.db.exists("UTM Source", {"slug": slug})
		if existing:
			doc = frappe.get_doc("UTM Source", existing if isinstance(existing, str) else name)
			doc.slug = slug
			doc.description = description
			doc.save(ignore_permissions=True)
			updated += 1
			continue
		doc = frappe.get_doc(
			{
				"doctype": "UTM Source",
				"name": name,
				"slug": slug,
				"description": description,
			}
		)
		doc.insert(ignore_permissions=True)
		created += 1
	frappe.db.commit()
	return {"created": created, "updated": updated}


def _connect():
	import os

	sites_dir = BENCH_PATH / "sites"
	(sites_dir / SITE / "logs").mkdir(parents=True, exist_ok=True)
	(BENCH_PATH / "logs").mkdir(parents=True, exist_ok=True)
	os.chdir(sites_dir)
	sys.path.insert(0, str(BENCH_PATH))
	import frappe

	frappe.init(site=SITE, sites_path=str(sites_dir), force=True)
	frappe.connect()
	return frappe


if __name__ == "__main__":
	frappe = _connect()
	try:
		print(seed_website_enquiry())
	finally:
		frappe.destroy()
