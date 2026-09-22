# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe

from healthcare.healthcare.doctype.patient_encounter.patient_encounter import (
	PatientEncounter,
	get_medications_query,
	get_permitted_patient,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientEncounter(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		gender_m = frappe.get_doc({"doctype": "Gender", "gender": "Male"})
		gender_f = frappe.get_doc({"doctype": "Gender", "gender": "Female"})

		self.patient_male = frappe.get_doc(
			{
				"doctype": "Patient",
				"first_name": "John",
				"sex": gender_m.gender,
				"customer_group": "Individual",
			}
		).insert()
		self.patient_female = frappe.get_doc(
			{
				"doctype": "Patient",
				"first_name": "Curie",
				"sex": gender_f.gender,
				"customer_group": "Individual",
			}
		).insert()
		self.practitioner = frappe.get_doc(
			{
				"doctype": "Healthcare Practitioner",
				"first_name": "Doc",
				"sex": "Male",
			}
		).insert()
		try:
			self.care_plan_male = frappe.get_doc(
				{
					"doctype": "Treatment Plan Template",
					"template_name": "test plan - m",
					"gender": gender_m.gender,
				}
			).insert()
			self.care_plan_female = frappe.get_doc(
				{
					"doctype": "Treatment Plan Template",
					"template_name": "test plan - f",
					"gender": gender_f.gender,
				}
			).insert()
		except frappe.exceptions.DuplicateEntryError:
			self.care_plan_male = frappe.get_doc(
				{
					"doctype": "Treatment Plan Template",
					"template_name": "test plan - m",
					"gender": gender_m.gender,
				}
			)
			self.care_plan_female = frappe.get_doc(
				{
					"doctype": "Treatment Plan Template",
					"template_name": "test plan - f",
					"gender": gender_f.gender,
				}
			)

	def test_treatment_plan_template_filter(self):
		encounter = frappe.get_doc(
			{
				"doctype": "Patient Encounter",
				"patient": self.patient_male.name,
				"practitioner": self.practitioner.name,
				"appointment_type": "_Test Appointment Type",
			}
		).insert()
		plans = PatientEncounter.get_applicable_treatment_plans(encounter.as_dict())
		self.assertEqual(plans[0]["name"], self.care_plan_male.template_name)

		encounter = frappe.get_doc(
			{
				"doctype": "Patient Encounter",
				"patient": self.patient_female.name,
				"practitioner": self.practitioner.name,
				"appointment_type": "_Test Appointment Type",
			}
		).insert()
		plans = PatientEncounter.get_applicable_treatment_plans(encounter.as_dict())
		self.assertEqual(plans[0]["name"], self.care_plan_female.template_name)

	def test_get_medications_query(self):
		medication = frappe.db.get_value("Medication", {"generic_name": "Paracetamol"})
		item = frappe.db.get_value("Medication Linked Item", {"parent": medication}, "item")

		results = get_medications_query("Item", None, "name", 0, 20, {"medication": medication})
		self.assertIn(item, [row[0] for row in results])

	def test_get_medications_query_filters_by_search_text(self):
		medication = frappe.db.get_value("Medication", {"generic_name": "Paracetamol"})
		filters = {"medication": medication}

		self.assertTrue(get_medications_query("Item", "Paracetamol", "name", 0, 20, filters))
		self.assertFalse(get_medications_query("Item", "no such item", "name", 0, 20, filters))

	def test_get_medications_query_shows_stock_in_company_warehouse(self):
		medication = frappe.db.get_value("Medication", {"generic_name": "Paracetamol"})
		company = frappe.db.get_value("Company", {}, "name")
		warehouse = frappe.get_cached_value("Company", company, "default_warehouse")
		if not warehouse:
			self.skipTest("No default warehouse set on company")

		results = get_medications_query(
			"Item", None, "name", 0, 20, {"medication": medication, "company": company}
		)
		self.assertTrue(any("Actual Qty" in str(column) for column in results[0]))


class TestAllergyAnnotationPermission(HealthcareTestSuite):
	"""The drug search takes the patient from its filters, so it must not annotate one the
	caller has no right to read"""

	def test_a_readable_patient_is_annotated(self):
		self.assertEqual(get_permitted_patient({"patient": "_Test Patient"}), "_Test Patient")

	def test_a_patient_the_caller_cannot_read_is_not_annotated(self):
		frappe.set_user("Guest")
		try:
			self.assertIsNone(get_permitted_patient({"patient": "_Test Patient"}))
		finally:
			frappe.set_user("Administrator")

	def test_no_patient_filter_annotates_nothing(self):
		self.assertIsNone(get_permitted_patient({}))
