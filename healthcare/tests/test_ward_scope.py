# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.permissions import add_user_permission

from healthcare.healthcare.api.nursing_common import ChartAccess, WardScope
from healthcare.tests.utils import HealthcareTestSuite

NURSE = "nurse@marleyhealth.io"

WARD = "_Test HSU - Occupancy - _TC"
OTHER_WARD = "_Test HSU - OT - _TC"


class TestWardScope(HealthcareTestSuite):
	"""A nurse assigned to a ward charts the patients in it, and nobody else."""

	def setUp(self):
		super().setUp()
		self.start_without_user_permissions(NURSE)
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
		)

		frappe.db.delete("Inpatient Record")
		self.patient, self.outpatient = "_Test Patient", "_Test Patient 0"

		record = create_inpatient(self.patient)
		record.expected_length_of_stay = 0
		record.save()
		record.reload()
		admit_patient(record, get_healthcare_service_unit(), frappe.utils.now_datetime())  # WARD, made vacant
		self.admission = record.name

	def assign_nurse_to(self, unit):
		add_user_permission("Healthcare Service Unit", unit, NURSE, ignore_permissions=True)
		frappe.clear_cache(user=NURSE)

	def test_an_unassigned_nurse_is_not_ward_scoped(self):
		with self.set_user(NURSE):
			self.assertFalse(WardScope().restricted())
			ChartAccess(self.patient).to_read()
			ChartAccess(self.outpatient).to_read()

	def test_a_ward_nurse_charts_a_patient_on_their_ward(self):
		self.assign_nurse_to(WARD)

		with self.set_user(NURSE):
			ChartAccess(self.patient).to_write("Observation")

	def test_a_ward_nurse_is_refused_a_patient_on_another_ward(self):
		self.assign_nurse_to(OTHER_WARD)

		with self.set_user(NURSE):
			self.assertRaises(frappe.PermissionError, ChartAccess(self.patient).to_read)

	def test_a_ward_nurse_is_refused_a_patient_who_is_not_in_any_unit(self):
		self.assign_nurse_to(WARD)

		with self.set_user(NURSE):
			self.assertRaises(frappe.PermissionError, ChartAccess(self.outpatient).to_read)

	def test_a_procedure_in_the_ward_brings_its_patient_into_scope(self):
		self.assign_nurse_to(WARD)
		procedure = self.make_procedure(self.outpatient, WARD)

		with self.set_user(NURSE):
			ChartAccess(self.outpatient, "Clinical Procedure", procedure).to_read()

	def test_the_patient_search_only_finds_the_ward(self):
		from healthcare.healthcare.api.nursing import find_patients

		self.assign_nurse_to(WARD)

		with self.set_user(NURSE):
			found = [match["name"] for match in find_patients("_Test")]

		self.assertIn(self.patient, found)
		self.assertNotIn(self.outpatient, found)

	def make_procedure(self, patient, service_unit):
		template = "_Test Procedure - Wound Inspection and Cleaning"
		procedure = frappe.get_doc(
			{
				"doctype": "Clinical Procedure",
				"patient": patient,
				"procedure_template": template,
				"service_unit": service_unit,
				"company": "_Test Company",
				"start_date": frappe.utils.today(),
			}
		)
		procedure.insert(ignore_permissions=True)
		return procedure.name
