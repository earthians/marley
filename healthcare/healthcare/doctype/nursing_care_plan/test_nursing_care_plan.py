# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.nursing_care_plan import (
	add_goal,
	get_active_orders,
	get_care_plan,
	set_goal_status,
	start_care_plan,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestNursingCarePlan(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		frappe.db.delete("Nursing Care Plan", {"patient": self.patient})

	def start(self, goal="Reports pain 3/10 or less at rest"):
		return start_care_plan(self.patient, [{"goal": goal}])

	def test_a_plan_records_who_took_the_patient_over(self):
		name = self.start()

		plan = frappe.get_doc("Nursing Care Plan", name)
		self.assertEqual(plan.started_by, frappe.session.user)
		self.assertTrue(plan.started_on)
		self.assertEqual(plan.status, "Active")

	def test_a_plan_needs_a_goal_to_start(self):
		self.assertRaises(frappe.ValidationError, start_care_plan, self.patient, [])

	def test_blank_goals_do_not_count(self):
		self.assertRaises(frappe.ValidationError, start_care_plan, self.patient, [{"goal": "   "}])

	def test_the_live_plan_comes_back_with_its_goals(self):
		self.start(goal="Walks 20 m unaided")

		plan = get_care_plan(self.patient)
		self.assertEqual(plan["goals"][0]["goal"], "Walks 20 m unaided")
		self.assertEqual(plan["goals"][0]["status"], "In Progress")

	def test_goals_are_added_to_the_live_plan(self):
		name = self.start()

		add_goal(name, "Afebrile for 24 hours")

		self.assertEqual(len(get_care_plan(self.patient)["goals"]), 2)

	def test_a_goal_can_be_marked_met(self):
		name = self.start()
		goal = get_care_plan(self.patient)["goals"][0]["name"]

		set_goal_status(name, goal, "Met")

		self.assertEqual(get_care_plan(self.patient)["goals"][0]["status"], "Met")

	def test_a_closed_plan_is_not_the_live_one(self):
		name = self.start()
		frappe.db.set_value("Nursing Care Plan", name, "status", "Closed")

		self.assertIsNone(get_care_plan(self.patient))

	def test_active_orders_exclude_finished_ones(self):
		orders = get_active_orders(self.patient)

		self.assertIsInstance(orders, list)
