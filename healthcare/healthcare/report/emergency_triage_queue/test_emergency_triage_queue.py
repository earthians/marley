# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

from frappe.utils import add_to_date, now_datetime

from healthcare.healthcare.report.emergency_triage_queue.emergency_triage_queue import execute
from healthcare.tests.factories.encounters import create_emergency_record
from healthcare.tests.utils import HealthcareTestSuite


class TestEmergencyTriageQueue(HealthcareTestSuite):
	def test_active_records_ordered_by_acuity(self):
		non_urgent = create_emergency_record("_Test Patient")
		non_urgent.record_triage("Non-urgent")
		emergency = create_emergency_record("_Test Patient 1")
		emergency.record_triage("Emergency")

		names = [row["name"] for row in execute()[1]]
		self.assertIn(emergency.name, names)
		self.assertIn(non_urgent.name, names)
		self.assertLess(names.index(emergency.name), names.index(non_urgent.name))

	def test_untriaged_sorts_last_with_empty_acuity(self):
		triaged = create_emergency_record("_Test Patient")
		triaged.record_triage("Emergency")
		untriaged = create_emergency_record("_Test Patient 1")

		names = [row["name"] for row in execute()[1]]
		self.assertLess(names.index(triaged.name), names.index(untriaged.name))
		self.assertEqual(row_for(untriaged.name)["acuity"], "")
		self.assertIn("span", row_for(triaged.name)["acuity"])

	def test_minutes_in_department(self):
		record = create_emergency_record(
			"_Test Patient", arrival_datetime=add_to_date(now_datetime(), minutes=-30)
		)
		self.assertGreaterEqual(row_for(record.name)["minutes_in_department"], 29)

	def test_company_filter(self):
		record = create_emergency_record("_Test Patient")
		included = [row["name"] for row in execute({"company": "_Test Company"})[1]]
		self.assertIn(record.name, included)
		excluded = [row["name"] for row in execute({"company": "_Test Company 1"})[1]]
		self.assertNotIn(record.name, excluded)

	def test_closed_records_excluded(self):
		record = create_emergency_record("_Test Patient")
		record.set_disposition("Discharged")
		names = [row["name"] for row in execute()[1]]
		self.assertNotIn(record.name, names)


def row_for(name):
	return next(row for row in execute()[1] if row["name"] == name)
