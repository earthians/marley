# Copyright (c) 2026, healthcare contributors

from datetime import timedelta

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import cint, getdate, nowdate

from healthcare.api.medication_auto_stop import AUTO_STOP_REASON, _ordering_practitioner, _stop_entry


class TestMedicationAutoStop(IntegrationTestCase):
	def test_stop_entry_marks_stopped_with_ordering_doctor(self):
		patient = frappe.get_all("Patient", limit=1, pluck="name")
		if not patient:
			self.skipTest("No Patient")
		patient = patient[0]

		item = frappe.get_all("Item", filters={"disabled": 0}, limit=1, pluck="name")
		if not item:
			self.skipTest("No Item")
		item = item[0]

		practitioner = frappe.get_all("Healthcare Practitioner", limit=1, pluck="name")
		practitioner = practitioner[0] if practitioner else None

		yesterday = getdate(nowdate()) - timedelta(days=1)
		pmo = frappe.get_doc(
			{
				"doctype": "Patient Medication Order",
				"patient": patient,
				"posting_date": yesterday,
				"start_date": yesterday,
				"legacy": 0,
				"new_system": 1,
				"care_context": "Inpatient Admission",
				"practitioner": practitioner,
				"healthcare_practitioner": practitioner,
				"medication_orders": [
					{
						"drug": item,
						"date": yesterday,
						"end_date": yesterday,
						"dosage": "1",
						"healthcare_practitioner": practitioner,
						"stopped": 0,
					}
				],
			}
		)
		pmo.insert(ignore_permissions=True)
		entry = pmo.medication_orders[0]

		row = frappe._dict(
			name=entry.name,
			parent=pmo.name,
			end_date=yesterday,
			drug=item,
			drug_name=entry.drug_name,
			healthcare_practitioner=practitioner,
			patient=patient,
			practitioner=practitioner,
			order_healthcare_practitioner=practitioner,
		)
		self.assertEqual(_ordering_practitioner(row), practitioner)
		self.assertTrue(_stop_entry(row, getdate(nowdate())))

		saved = frappe.db.get_value(
			"Inpatient Medication Order Entry",
			entry.name,
			["stopped", "reason_stopped", "medication_status", "stoped_by"],
			as_dict=True,
		)
		self.assertEqual(cint(saved.stopped), 1)
		self.assertEqual(saved.reason_stopped, AUTO_STOP_REASON)
		self.assertEqual(saved.medication_status, "Discontinued")
		if practitioner:
			self.assertEqual(saved.stoped_by, practitioner)

		# Idempotent — already stopped lines are skipped.
		self.assertFalse(_stop_entry(row, getdate(nowdate())))

		frappe.delete_doc("Patient Medication Order", pmo.name, force=True, ignore_permissions=True)
