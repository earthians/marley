#!/usr/bin/env python3
"""Idempotent site seed for public website clinic catalog.

Run from the bench directory:

    cd /home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd
    python ../Helper_codes/Seeding/seed_clinic_catalog.py
"""

from pathlib import Path
import sys

SEEDING_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SEEDING_DIR))

from seed_booking_catalog import seed_booking_catalog  # noqa: E402

BENCH_PATH = Path("/home/mahmoud-g-m/Frappe-Projetcs/Abuzahraptc_BackEnd/BackEnd")
SITE = "senlite.localhost"

PUBLIC_DOCTORS = [
	{
		"first_name": "Dr. Mohamed",
		"last_name": "Abu Zahra",
		"credentials": "PT Consultant, DPT",
		"role": "Chairman",
		"specialty": "Physical Therapy & Manual Therapy",
		"branches": ["Mohandeseen", "Sheikh Zayed", "New Cairo (Diza)"],
		"languages": ["Arabic", "English"],
		"bio": "Chairman of Abu Zahra Physical Therapy Center and a leading physical therapy consultant. Holds a Doctorate in Physical Therapy (DPT) with advanced diplomas in joint disorders and spinal conditions. Certified in Maitland, Mulligan, and McKenzie manual therapy concepts. Member of IFOMT, APTA, and the Egyptian Society of Manual Therapy.",
		"certifications": [
			"Doctorate in Physical Therapy (DPT)",
			"Diploma in Joint Disorders — Cairo University",
			"Diploma in Spinal Conditions — Winston-Salem University, USA",
			"Maitland Concept — IMTA",
			"Mulligan Concept — Mulligan Institute",
			"McKenzie Certified Practitioner",
			"IFOMT Member",
			"APTA Member",
			"Ergonomics Specialist",
		],
		"expertise": [
			"Manual Therapy",
			"Spinal Rehabilitation",
			"Joint Disorders",
			"Physical Therapy Consultation",
		],
	},
	{
		"first_name": "Dr. Abd El-Raheem",
		"last_name": "Baidar",
		"credentials": "PT Consultant",
		"role": "Technical Manager — Diza Branch",
		"specialty": "Health Insurance & Manual Therapy",
		"branches": ["New Cairo (Diza)"],
		"languages": ["Arabic", "English"],
		"bio": "Physical therapy consultant accredited by health insurance companies. Graduate of Cairo University Faculty of Physical Therapy with a Master's in joint rehabilitation. Certified in Mulligan manual therapy and holds a diploma in post-mastectomy rehabilitation from Cairo University.",
		"certifications": [
			"Cairo University Faculty of Physical Therapy",
			"Master's in Joint Rehabilitation",
			"Mulligan Certified Practitioner",
			"Post-Mastectomy Rehabilitation Diploma — Cairo University",
		],
		"expertise": [
			"Health Insurance PT Consultation",
			"Joint Rehabilitation",
			"Manual Therapy",
			"Post-Mastectomy Rehab",
		],
	},
	{
		"first_name": "Dr. Amr",
		"last_name": "El Othmani",
		"credentials": "PT, MSc",
		"role": "Sheikh Zayed Branch Manager",
		"specialty": "Manual Therapy & Dry Needling",
		"branches": ["Sheikh Zayed"],
		"languages": ["Arabic", "English"],
		"bio": "Sheikh Zayed Branch Manager with a Master's in Manual Therapy from Prime Physio (OMTA) and Mulligan Concept certification. Holds AIMS Dry Needling Practitioner certification and multiple first-aid and emergency response qualifications.",
		"certifications": [
			"Master's in Manual Therapy — Prime Physio (OMTA)",
			"Mulligan Concept — Prime Physio",
			"AIMS Dry Needling Practitioner Program",
			"Basic Life Support & CPR",
			"PFA First Aid Certification",
		],
		"expertise": ["Manual Therapy", "Mulligan Concept", "Dry Needling", "Branch Management"],
	},
	{
		"first_name": "Dr. Ahmed",
		"last_name": "Omer",
		"credentials": "PT, BSc",
		"role": "Mohandeseen Branch Manager",
		"specialty": "Manual Therapy & Orthopedics",
		"branches": ["Mohandeseen"],
		"languages": ["Arabic", "English"],
		"bio": "Mohandeseen Branch Manager since 2015. Specialist in blood circulation treatment and joint stiffness. Holds a diploma in manual therapy from Prime Physio (OMTA) using the latest manual therapy and dry needling techniques for joints and vertebrae.",
		"certifications": [
			"BSc Physical Therapy — 2015",
			"Manual Therapy Diploma — Prime Physio (OMTA)",
			"Dry Needling Certification",
			"External Fixation Course — Egyptian Ministry of Health",
			"Training Courses — Egyptian Ministry of Health",
		],
		"expertise": ["Manual Therapy", "Joint Stiffness", "Dry Needling", "Orthopedic Rehabilitation"],
	},
	{
		"first_name": "Dr. Fatma",
		"last_name": "Mahmoud",
		"credentials": "PT, BSc",
		"role": "Sheikh Zayed Branch Manager",
		"specialty": "Manual Therapy & Mulligan Concept",
		"branches": ["Sheikh Zayed"],
		"languages": ["Arabic", "English"],
		"bio": "Sheikh Zayed Branch Manager. Graduate of Cairo University Faculty of Physical Therapy (2015). Head of the Physical Therapy Department in the Medical Devices sector. Holds manual therapy and Mulligan technique diplomas from Prime Physio.",
		"certifications": [
			"BSc Physical Therapy — Cairo University, 2015",
			"Manual Therapy Diploma — Prime Physio",
			"Mulligan Technique Diploma — Prime Physio",
			"Manual & Physical Therapy Training — Ministry of Health",
		],
		"expertise": ["Manual Therapy", "Mulligan Concept", "Joint Rehabilitation", "Branch Management"],
	},
	{
		"first_name": "Dr. Ibrahim",
		"last_name": "Ghamem",
		"credentials": "PT, BSc",
		"role": "Sheikh Zayed Branch Manager",
		"specialty": "Orthopedic Manual Therapy",
		"branches": ["Sheikh Zayed"],
		"languages": ["Arabic", "English"],
		"bio": "Sheikh Zayed Branch Manager. Graduate of Cairo University Faculty of Physical Therapy (2015). Head of the Physical Therapy Department in the Medical Devices sector with diplomas in manual therapy and joint treatment using Mulligan technique from Prime Physio.",
		"certifications": [
			"BSc Physical Therapy — Cairo University, 2015",
			"Manual Therapy Diploma — Prime Physio",
			"Mulligan Joint Treatment — Prime Physio",
			"Manual & Physical Therapy Training — Ministry of Health",
		],
		"expertise": ["Orthopedic Manual Therapy", "Mulligan Concept", "Joint Treatment", "Branch Management"],
	},
	{
		"first_name": "Dr. Omar",
		"last_name": "Hashem",
		"credentials": "PT, BSc",
		"role": "New Cairo (Diza) Branch Manager",
		"specialty": "Orthopedic Manual Therapy & Dry Needling",
		"branches": ["New Cairo (Diza)"],
		"languages": ["Arabic", "English"],
		"bio": "New Cairo (Diza) Branch Manager. Graduate in Physical Therapy (2019) with a Master's in Assistive Technology from Cairo University. Certified in orthopedic manual therapy, Mulligan practitioner, and dry needling.",
		"certifications": [
			"BSc Physical Therapy — 2019",
			"Master's in Assistive Technology — Cairo University",
			"Certified Orthopedic Manual Therapy",
			"Mulligan Practitioner",
			"Dry Needling Practitioner",
		],
		"expertise": ["Orthopedic Manual Therapy", "Mulligan Concept", "Dry Needling", "Assistive Technology"],
	},
]

INSURANCE_PAYORS = [
	("insurance", "Medlife"),
	("insurance", "MetLife"),
	("insurance", "AXA"),
	("insurance", "DMS Medical Insurance"),
	("insurance", "Hayah"),
	("insurance", "Medi-Rey"),
	("insurance", "Prime Medical Services (Al-Sayeh)"),
	("insurance", "Misr Insurance for Healthcare"),
	("insurance", "Allianz"),
	("insurance", "Libano-Suisse"),
	("insurance", "Royal Insurance"),
	("insurance", "NextCare"),
	("insurance", "MetLife Skein"),
	("insurance", "Al-Sayeh Life"),
	("insurance", "Misr Insurance & Arbaw"),
	("insurance", "Wadi (Medical Services)"),
	("insurance", "GlobeMed Egypt"),
	("insurance", "Misr Life"),
	("insurance", "MetLife G"),
	("insurance", "Healthcare Insurance Investigators"),
	("insurance", "GlobeMed"),
	("insurance", "Nosco"),
	("healthcare", "Egyptian General Petroleum Corporation"),
	("healthcare", "Egyptian Cooperative Insurance"),
	("healthcare", "South Delta Cooperative"),
	("healthcare", "Mikiya Chemicals Cooperative"),
	("healthcare", "Petrojet"),
	("healthcare", "Suez Oil Company (Bagco)"),
	("healthcare", "Internal Trade Cooperative"),
	("healthcare", "Petroleum Cooperative"),
	("healthcare", "Suco Suez"),
	("healthcare", "Egypt Gas"),
	("healthcare", "Petroleum Bank Cooperative"),
	("healthcare", "Petrotrade"),
	("healthcare", "Eastern Petro Cooperative"),
	("healthcare", "Heritage Cooperative"),
	("healthcare", "Sharq Petro Cooperative"),
	("healthcare", "Sinai Construction"),
	("healthcare", "Portfolio Cooperative"),
	("healthcare", "ENI Aoia"),
	("healthcare", "Gas Nat"),
	("healthcare", "Gasco Medical Gas Egypt"),
	("healthcare", "Gasco Gas Production & Transport"),
	("healthcare", "Egypt WinFresh"),
	("healthcare", "OGS Steel Materials Egypt"),
	("healthcare", "El Hewa"),
	("healthcare", "Zag Construction"),
	("healthcare", "Zag Sinai"),
	("healthcare", "Wadi Lin Zag"),
	("healthcare", "Zag Informatics"),
	("healthcare", "Zag Lin"),
	("healthcare", "Nasnomia Cooperative"),
	("healthcare", "Agia Medical Gas Egypt"),
	("healthcare", "Sajia Gas"),
	("healthcare", "UGDC Unified Company for Zag Projects"),
	("healthcare", "Zag Kit"),
	("healthcare", "Bat Dim"),
	("healthcare", "Ronak Cooperative"),
	("healthcare", "Pico Bip"),
	("healthcare", "Bijea Cooperative"),
	("healthcare", "BP Bijia"),
	("healthcare", "International Egyptian Steel (Aoia)"),
	("healthcare", "Egypt Security Products (Bapom)"),
	("healthcare", "Rimortb Company"),
	("healthcare", "ECGS Egyptian Cooperative Gas Services"),
	("healthcare", "Gasco Auto Gas Production & Transport"),
	("healthcare", "Cairo Territory Cooperative"),
	("healthcare", "Dichsport Company"),
	("healthcare", "Dimos Arab Petroleum Banali"),
	("healthcare", "Sajir Milaqal Zag"),
	("healthcare", "Amal Cooperative"),
	("healthcare", "Gasig"),
	("healthcare", "Dosq Cooperative"),
	("healthcare", "Saj Gasco"),
	("healthcare", "Saj Portfolio"),
	("healthcare", "Saj Gas"),
	("special", "Employee Insurance Authority"),
	("special", "Supreme Council of Universities"),
	("special", "Egyptian Medical Syndicate"),
	("special", "Scouting"),
	("special", "Engineers Syndicate"),
	("special", "German University in Cairo (GUC)"),
	("special", "American University in Cairo (AUC)"),
	("bank", "Commercial International Bank (CIB)"),
	("bank", "Banque Misr"),
	("bank", "National Bank of Egypt"),
	("bank", "Bank of Egypt"),
	("bank", "Arab African International Bank"),
	("bank", "Healthcare Services Bank"),
]


def _join(items):
	return "\n".join(items)


def _website_fields(doctor):
	return {
		"status": "Active",
		"show_in_portal": 1,
		"website_credentials": doctor["credentials"],
		"website_role": doctor["role"],
		"website_specialty": doctor["specialty"],
		"website_languages": _join(doctor["languages"]),
		"website_branches": _join(doctor["branches"]),
		"website_bio": doctor["bio"],
		"website_certifications": _join(doctor["certifications"]),
		"website_expertise": _join(doctor["expertise"]),
	}


def _find_practitioner(frappe, doctor):
	full_name = f"{doctor['first_name']} {doctor['last_name']}".strip()
	name = frappe.db.get_value("Healthcare Practitioner", {"practitioner_name": full_name}, "name")
	if name:
		return name
	return frappe.db.get_value(
		"Healthcare Practitioner",
		{"first_name": doctor["first_name"], "last_name": doctor["last_name"]},
		"name",
	)


def seed_doctors():
	import frappe

	gender = "Male" if frappe.db.exists("Gender", "Male") else frappe.db.get_value("Gender", {}, "name")
	created = 0
	updated = 0
	for doctor in PUBLIC_DOCTORS:
		fields = _website_fields(doctor)
		existing = _find_practitioner(frappe, doctor)
		if existing:
			doc = frappe.get_doc("Healthcare Practitioner", existing)
			doc.update(fields)
			doc.save(ignore_permissions=True)
			updated += 1
			continue
		payload = {
			"doctype": "Healthcare Practitioner",
			"naming_series": "HLC-PRAC-.YYYY.-",
			"first_name": doctor["first_name"],
			"last_name": doctor["last_name"],
			"practitioner_type": "External",
			**fields,
		}
		if gender:
			payload["gender"] = gender
		frappe.get_doc(payload).insert(ignore_permissions=True, ignore_mandatory=True)
		created += 1

	placeholder = frappe.db.get_value(
		"Healthcare Practitioner", {"practitioner_name": "Abu Zahra Clinic"}, "name"
	)
	if placeholder:
		frappe.db.set_value("Healthcare Practitioner", placeholder, "show_in_portal", 0)

	return {"created": created, "updated": updated}


def seed_insurance_payors():
	import frappe

	created = 0
	updated = 0
	failed = 0
	for category, label in INSURANCE_PAYORS:
		try:
			existing = frappe.db.exists("Insurance Payor", label) or frappe.db.exists(
				"Insurance Payor", {"insurance_payor_name": label}
			)
			if existing:
				name = existing if isinstance(existing, str) else label
				doc = frappe.get_doc("Insurance Payor", name)
				doc.disabled = 0
				doc.show_on_website = 1
				doc.website_category = category
				doc.save(ignore_permissions=True, ignore_mandatory=True)
				updated += 1
				continue
			frappe.get_doc(
				{
					"doctype": "Insurance Payor",
					"insurance_payor_name": label,
					"disabled": 0,
					"show_on_website": 1,
					"website_category": category,
				}
			).insert(ignore_permissions=True, ignore_mandatory=True)
			created += 1
		except Exception:
			frappe.clear_last_message()
			failed += 1
	return {"created": created, "updated": updated, "failed": failed}


def seed_clinic_catalog():
	booking = seed_booking_catalog()
	doctors = seed_doctors()
	payors = seed_insurance_payors()
	import frappe

	frappe.db.commit()
	return {"booking": booking, "doctors": doctors, "payors": payors}


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
		result = seed_clinic_catalog()
		print(result)
	finally:
		frappe.destroy()
