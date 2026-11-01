# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.setup import create_intake_output_types
from healthcare.tests.utils import HealthcareTestSuite


class TestIntakeOutputEntry(HealthcareTestSuite):
	def setUp(self):
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		create_intake_output_types()

	def make_entry(self, **kwargs):
		values = {
			"doctype": "Intake Output Entry",
			"patient": self.patient,
			"intake_output_type": "Oral",
			"volume": 200,
		}
		values.update(kwargs)
		return frappe.get_doc(values).insert(ignore_permissions=True)

	def test_entry_fetches_direction_and_uom_from_its_type(self):
		entry = self.make_entry()

		self.assertEqual(entry.direction, "Intake")
		self.assertEqual(entry.uom, "Millilitre")

	def test_output_type_records_the_other_direction(self):
		entry = self.make_entry(intake_output_type="Urine", volume=550)

		self.assertEqual(entry.direction, "Output")

	def test_volume_must_be_positive(self):
		self.assertRaises(frappe.ValidationError, self.make_entry, volume=0)

	def test_entry_records_who_entered_it(self):
		entry = self.make_entry()

		self.assertEqual(entry.user, frappe.session.user)

	def test_entry_links_back_to_its_source_document(self):
		entry = self.make_entry(reference_doctype="Patient", reference_name=self.patient)

		self.assertEqual(entry.reference_doctype, "Patient")
		self.assertEqual(entry.reference_name, self.patient)

	def test_types_are_seeded_for_both_directions(self):
		directions = frappe.get_all("Intake Output Type", pluck="direction")

		self.assertIn("Intake", directions)
		self.assertIn("Output", directions)
