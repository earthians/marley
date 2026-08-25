# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.handover import (
	accept_handover,
	get_handovers,
	get_outstanding,
	record_handover,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestShiftHandover(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.other_nurse = self.make_nurse()
		frappe.db.delete("Shift Handover", {"patient": self.patient})

	def make_nurse(self, email="incoming.nurse@example.com"):
		if not frappe.db.exists("User", email):
			frappe.get_doc({"doctype": "User", "email": email, "first_name": "Incoming Nurse"}).insert(
				ignore_permissions=True
			)
		return email

	def hand_over(self, **values):
		values.setdefault("handed_over_to", self.other_nurse)
		values.setdefault("situation", "Febrile since midday")
		return record_handover(self.patient, values)

	def test_a_handover_names_who_is_taking_over(self):
		name = self.hand_over()

		document = frappe.get_doc("Shift Handover", name)
		self.assertEqual(document.handed_over_to, self.other_nurse)
		self.assertEqual(document.handed_over_by, frappe.session.user)
		self.assertEqual(document.status, "Handed Over")

	def test_a_handover_without_a_recipient_throws(self):
		self.assertRaises(frappe.ValidationError, record_handover, self.patient, {"situation": "Unwell"})

	def test_a_handover_without_a_situation_throws(self):
		self.assertRaises(
			frappe.ValidationError,
			record_handover,
			self.patient,
			{"handed_over_to": self.other_nurse},
		)

	def test_the_rest_of_sbar_is_optional(self):
		name = record_handover(self.patient, {"handed_over_to": self.other_nurse, "situation": "Febrile"})

		self.assertTrue(name)

	def test_handing_over_to_yourself_throws(self):
		self.assertRaises(frappe.ValidationError, self.hand_over, handed_over_to=frappe.session.user)

	def test_only_the_receiving_nurse_can_accept(self):
		name = self.hand_over()

		self.assertRaises(frappe.ValidationError, accept_handover, name)

	def test_accepting_stamps_who_and_when(self):
		name = self.hand_over()
		frappe.set_user(self.other_nurse)
		self.addCleanup(frappe.set_user, "Administrator")

		accept_handover(name)

		document = frappe.get_doc("Shift Handover", name)
		self.assertEqual(document.status, "Accepted")
		self.assertEqual(document.accepted_by, self.other_nurse)
		self.assertTrue(document.accepted_at)

	def test_outstanding_work_is_gathered_not_retyped(self):
		outstanding = get_outstanding(self.patient)

		self.assertIn("tasks", outstanding)
		self.assertIn("medications", outstanding)

	def test_handovers_come_back_newest_first(self):
		first = self.hand_over(situation="Earlier")
		# the patient can only be handed on once the last one was taken
		frappe.db.set_value("Shift Handover", first, "status", "Accepted")
		self.hand_over(situation="Later")

		self.assertEqual(get_handovers(self.patient)[0].situation, "Later")

	def test_a_second_handover_while_one_is_pending_throws(self):
		self.hand_over()

		self.assertRaises(frappe.ValidationError, self.hand_over)

	def test_handing_on_is_allowed_once_accepted(self):
		name = self.hand_over()
		frappe.db.set_value("Shift Handover", name, "status", "Accepted")

		self.assertTrue(self.hand_over())
