# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.nursing_common import ChartAccess
from healthcare.tests.utils import HealthcareTestSuite

NURSE = "nurse@marleyhealth.io"
NOBODY = "test_user@marleyhealth.io"  # a login with no clinical role at all


class TestChartAccess(HealthcareTestSuite):
	"""Who may write to a patient's chart, and against which record."""

	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import create_inpatient

		self.make_nurse()
		self.patient, self.other_patient = frappe.get_list("Patient", pluck="name", limit=2)
		frappe.db.sql("delete from `tabInpatient Record`")
		admission = create_inpatient(self.other_patient)
		admission.save()
		self.admission = admission.name

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.delete("Inpatient Record", {"name": self.admission})
		frappe.db.set_value(
			"Patient", self.other_patient, {"inpatient_record": None, "inpatient_status": None}
		)

	def make_nurse(self):
		if frappe.db.exists("User", NURSE):
			return
		frappe.get_doc(
			{
				"doctype": "User",
				"email": NURSE,
				"first_name": "nurse",
				"send_welcome_email": 0,
				"roles": [{"role": "Nursing User"}],
			}
		).insert(ignore_permissions=True)

	def test_a_login_without_a_clinical_role_cannot_write_the_chart(self):
		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, ChartAccess(self.patient).to_write, "Observation")

	def test_a_login_without_a_clinical_role_cannot_read_the_chart(self):
		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, ChartAccess(self.patient).to_read)

	def test_a_nurse_may_write_the_chart(self):
		frappe.set_user(NURSE)

		ChartAccess(self.patient).to_write("Observation")

	def test_a_nurse_cannot_file_an_entry_under_another_patients_record(self):
		frappe.set_user(NURSE)
		access = ChartAccess(self.patient, "Inpatient Record", self.admission)

		self.assertRaises(frappe.PermissionError, access.to_write, "Observation")

	def test_an_entry_may_be_filed_under_the_patients_own_record(self):
		frappe.set_user(NURSE)

		ChartAccess(self.other_patient, "Inpatient Record", self.admission).to_write("Observation")

	def test_an_entry_may_be_filed_under_the_patient_themselves(self):
		frappe.set_user(NURSE)

		ChartAccess(self.patient, "Patient", self.patient).to_write("Observation")

	def test_a_reference_needs_both_its_parts(self):
		self.assertRaises(
			frappe.ValidationError, ChartAccess(self.patient, "Inpatient Record").to_write, "Observation"
		)

	def test_a_document_without_a_patient_cannot_be_a_reference(self):
		access = ChartAccess(self.patient, "Company", "_Test Company")

		self.assertRaises(frappe.ValidationError, access.to_write, "Observation")

	def test_the_banner_will_not_read_another_patients_record(self):
		from healthcare.healthcare.api.nursing import get_banner

		frappe.set_user(NURSE)

		self.assertRaises(
			frappe.PermissionError, get_banner, self.patient, "Inpatient Record", self.admission
		)

	def test_the_scheduler_run_over_every_patient_is_not_callable_remotely(self):
		from healthcare.healthcare.api import medication

		self.assertNotIn(medication.schedule_due_medications, frappe.whitelisted)
		self.assertIn(medication.schedule_patient_medications, frappe.whitelisted)

	def test_recording_vitals_as_nobody_is_refused(self):
		from healthcare.healthcare.api.vitals import record_vitals

		frappe.set_user(NOBODY)

		self.assertRaises(
			frappe.PermissionError, record_vitals, self.patient, {"_Test Pulse": 80}, "Patient", self.patient
		)

	def test_updating_a_task_as_nobody_is_refused(self):
		from healthcare.healthcare.api.nursing_tasks import update_nursing_task

		task = frappe.get_doc(
			{
				"doctype": "Nursing Task",
				"patient": self.patient,
				"activity": "BP Check",
				"status": "Requested",
				"company": "_Test Company",
				"requested_start_time": frappe.utils.now_datetime(),
			}
		).insert()
		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, update_nursing_task, task.name, "In Progress")
