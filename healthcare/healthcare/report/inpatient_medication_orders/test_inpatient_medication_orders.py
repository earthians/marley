# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt


import datetime

import frappe
from frappe.utils import getdate, now_datetime

from healthcare.healthcare.doctype.inpatient_medication_order.test_inpatient_medication_order import (
	create_ipme,
	create_ipmo,
)
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	admit_patient,
	discharge_patient,
	schedule_discharge,
)
from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
	create_inpatient,
	get_healthcare_service_unit,
	mark_invoiced_inpatient_occupancy,
)
from healthcare.healthcare.report.inpatient_medication_orders.inpatient_medication_orders import (
	execute,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestInpatientMedicationOrders(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		frappe.db.sql("delete from `tabInpatient Medication Order` where company='_Test Company'")
		frappe.db.sql("delete from `tabInpatient Medication Entry` where company='_Test Company'")
		self.patient = "_Test IPD Patient"
		self.ip_record = create_records(self.patient)

	def test_inpatient_medication_orders_report(self):
		filters = {
			"company": "_Test Company",
			"from_date": getdate(),
			"to_date": getdate(),
			"patient": "_Test IPD Patient",
			"service_unit": "_Test HSU - Occupancy - _TC",
		}

		report = execute(filters)

		expected_data = [
			{
				"patient": "_Test IPD Patient",
				"inpatient_record": self.ip_record.name,
				"healthcare_practitioner": None,
				"drug": "Dextromethorphan",
				"drug_name": "Dextromethorphan",
				"dosage": 1.0,
				"dosage_form": "Tablet",
				"date": getdate(),
				"time": datetime.timedelta(seconds=32400),
				"status": "Pending",
				"stop_reason": None,
				"is_completed": 0,
				"healthcare_service_unit": "_Test HSU - Occupancy - _TC",
			},
			{
				"patient": "_Test IPD Patient",
				"inpatient_record": self.ip_record.name,
				"healthcare_practitioner": None,
				"drug": "Dextromethorphan",
				"drug_name": "Dextromethorphan",
				"dosage": 1.0,
				"dosage_form": "Tablet",
				"date": getdate(),
				"time": datetime.timedelta(seconds=50400),
				"status": "Pending",
				"stop_reason": None,
				"is_completed": 0,
				"healthcare_service_unit": "_Test HSU - Occupancy - _TC",
			},
			{
				"patient": "_Test IPD Patient",
				"inpatient_record": self.ip_record.name,
				"healthcare_practitioner": None,
				"drug": "Dextromethorphan",
				"drug_name": "Dextromethorphan",
				"dosage": 1.0,
				"dosage_form": "Tablet",
				"date": getdate(),
				"time": datetime.timedelta(seconds=75600),
				"status": "Pending",
				"stop_reason": None,
				"is_completed": 0,
				"healthcare_service_unit": "_Test HSU - Occupancy - _TC",
			},
		]

		self.assertEqual(expected_data, report[1])

		filters = frappe._dict(from_date=getdate(), to_date=getdate(), from_time="", to_time="")
		ipme = create_ipme(filters)
		ipme.submit()

		filters = {
			"company": "_Test Company",
			"from_date": getdate(),
			"to_date": getdate(),
			"patient": "_Test IPD Patient",
			"service_unit": "_Test HSU - Occupancy - _TC",
			"show_completed_orders": 0,
		}

		report = execute(filters)
		self.assertEqual(len(report[1]), 0)

	def test_stopped_orders_are_not_reported_as_pending(self):
		ipmo = frappe.get_last_doc(
			"Inpatient Medication Order", filters={"patient": self.patient, "company": "_Test Company"}
		)
		today_rows = [entry.name for entry in ipmo.medication_orders if entry.date == getdate()]
		ipmo.stop_medication_orders([today_rows[0]], "Treatment changed")

		filters = {
			"company": "_Test Company",
			"from_date": getdate(),
			"to_date": getdate(),
			"patient": "_Test IPD Patient",
			"service_unit": "_Test HSU - Occupancy - _TC",
			"show_completed_orders": 0,
		}

		report = execute(filters)
		self.assertEqual(len(report[1]), 2)
		self.assertTrue(all(entry.status == "Pending" for entry in report[1]))

		filters["show_completed_orders"] = 1
		report = execute(filters)
		stopped_rows = [entry for entry in report[1] if entry.status == "Stopped"]

		self.assertEqual(len(stopped_rows), 1)
		self.assertEqual(stopped_rows[0].stop_reason, "Treatment changed")

	def tearDown(self):
		if frappe.db.get_value("Patient", self.patient, "inpatient_record"):
			# cleanup - Discharge
			schedule_discharge(frappe.as_json({"patient": self.patient}))
			self.ip_record.reload()
			mark_invoiced_inpatient_occupancy(self.ip_record)

			self.ip_record.reload()
			discharge_patient(self.ip_record)

		for entry in frappe.get_all("Inpatient Medication Entry"):
			doc = frappe.get_doc("Inpatient Medication Entry", entry.name)
			doc.cancel()
			doc.delete()

		for entry in frappe.get_all("Inpatient Medication Order"):
			doc = frappe.get_doc("Inpatient Medication Order", entry.name)
			doc.cancel()
			doc.delete()


def create_records(patient):
	frappe.db.sql("""delete from `tabInpatient Record`""")

	# Admit
	ip_record = create_inpatient(patient)
	ip_record.expected_length_of_stay = 0
	ip_record.save()
	ip_record.reload()
	service_unit = get_healthcare_service_unit()
	admit_patient(ip_record, service_unit, now_datetime())

	ipmo = create_ipmo(patient)
	ipmo.submit()

	return ip_record
