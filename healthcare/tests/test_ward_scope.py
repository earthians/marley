# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.permissions import add_user_permission

from healthcare.healthcare.api.nursing_common import ChartAccess, WardScope
from healthcare.tests.test_chart_access import NURSE
from healthcare.tests.utils import HealthcareTestSuite

WARD = "_Test HSU - Occupancy - _TC"
OTHER_WARD = "_Test HSU - OT - _TC"


class TestWardScope(HealthcareTestSuite):
	"""A nurse assigned to a ward charts the patients in it, and nobody else."""

	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
		)
		from healthcare.tests.test_chart_access import TestChartAccess

		TestChartAccess.make_nurse(self)
		frappe.db.delete("User Permission", {"user": NURSE})
		frappe.db.sql("delete from `tabInpatient Record`")
		self.patient, self.outpatient = frappe.get_list("Patient", pluck="name", limit=2)

		record = create_inpatient(self.patient)
		record.expected_length_of_stay = 0
		record.save()
		record.reload()
		admit_patient(record, get_healthcare_service_unit(), frappe.utils.now_datetime())  # WARD, made vacant
		self.admission = record.name

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.delete("User Permission", {"user": NURSE})
		frappe.db.delete("Inpatient Record", {"name": self.admission})
		frappe.db.set_value("Patient", self.patient, {"inpatient_record": None, "inpatient_status": None})
		frappe.clear_cache(user=NURSE)

	def assign_nurse_to(self, unit):
		add_user_permission("Healthcare Service Unit", unit, NURSE, ignore_permissions=True)
		frappe.clear_cache(user=NURSE)
		frappe.set_user(NURSE)

	def test_an_unassigned_nurse_is_not_ward_scoped(self):
		frappe.set_user(NURSE)

		self.assertFalse(WardScope().restricted())
		ChartAccess(self.patient).to_read()
		ChartAccess(self.outpatient).to_read()

	def test_a_ward_nurse_charts_a_patient_on_their_ward(self):
		self.assign_nurse_to(WARD)

		ChartAccess(self.patient).to_write("Observation")

	def test_a_ward_nurse_is_refused_a_patient_on_another_ward(self):
		self.assign_nurse_to(OTHER_WARD)

		self.assertRaises(frappe.PermissionError, ChartAccess(self.patient).to_read)

	def test_a_ward_nurse_is_refused_a_patient_who_is_not_in_any_unit(self):
		self.assign_nurse_to(WARD)

		self.assertRaises(frappe.PermissionError, ChartAccess(self.outpatient).to_read)

	def test_a_procedure_in_the_ward_brings_its_patient_into_scope(self):
		self.assign_nurse_to(WARD)
		frappe.set_user("Administrator")
		procedure = self.make_procedure(self.outpatient, WARD)
		frappe.set_user(NURSE)

		ChartAccess(self.outpatient, "Clinical Procedure", procedure).to_read()

	def test_the_patient_search_only_finds_the_ward(self):
		from healthcare.healthcare.api.nursing import find_patients

		self.assign_nurse_to(WARD)

		found = [match["name"] for match in find_patients("_Test")]

		self.assertIn(self.patient, found)
		self.assertNotIn(self.outpatient, found)

	def make_procedure(self, patient, service_unit):
		template = frappe.get_list("Clinical Procedure Template", pluck="name")[0]
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
		self.addCleanup(frappe.delete_doc, "Clinical Procedure", procedure.name, force=True)
		return procedure.name
