# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe

from healthcare.healthcare.doctype.clinical_procedure.procedure_safety_check import (
	get_medications,
	get_questions,
	get_safety_questions,
	read_questions,
)
from healthcare.tests.factories.encounters import create_procedure
from healthcare.tests.utils import HealthcareTestSuite


class TestProcedureSafetyCheck(HealthcareTestSuite):
	def test_no_questions_are_asked_when_the_check_is_off(self):
		with self.change_settings("Healthcare Settings", {"enable_procedure_safety_check": 0}):
			procedure = make_procedure()
			self.assertEqual(get_safety_questions(procedure.name), [])
			procedure.start_procedure()
		self.assertEqual(procedure.status, "In Progress")
		self.assertIsNone(procedure.safety_check)

	def test_settings_questions_come_before_the_template_questions(self):
		with self.enabled():
			sections = [question.section for question in get_questions(safety_template().name)]
		self.assertEqual(sections[-1], "Procedure")
		self.assertNotIn("Procedure", sections[:-1])

	def test_start_stores_the_answers_as_a_questionnaire_response(self):
		with self.enabled():
			procedure = make_procedure()
			procedure.start_procedure(answer_all(procedure))
		response = json.loads(procedure.safety_check)
		self.assertEqual(procedure.status, "In Progress")
		self.assertEqual(response["resourceType"], "QuestionnaireResponse")
		self.assertEqual(response["subject"]["reference"], f"Patient/{procedure.patient}")
		self.assertEqual(response["author"]["identifier"]["value"], frappe.session.user)

	def test_answers_keep_the_question_text_and_value(self):
		with self.enabled():
			procedure = make_procedure()
			procedure.start_procedure(answer_all(procedure))
		items = [item for section in json.loads(procedure.safety_check)["item"] for item in section["item"]]
		fasting = next(item for item in items if item["text"] == "Fasting since")
		self.assertEqual(fasting["answer"], [{"valueString": "06:00"}])
		coded = next(item for item in items if item["text"] != "Fasting since")
		self.assertEqual(coded["answer"][0]["valueCoding"]["code"], "Y")

	def test_a_no_answer_blocks_the_start(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			answers[first_coded_question(procedure)] = "N"
			self.assertRaises(frappe.ValidationError, procedure.start_procedure, answers)
		self.assertEqual(saved_status(procedure), "Pending")

	def test_an_unanswered_question_blocks_the_start(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			answers.pop(first_coded_question(procedure))
			self.assertRaises(frappe.ValidationError, procedure.start_procedure, answers)

	def test_a_blank_text_answer_blocks_the_start(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			answers[text_question(procedure)] = "  "
			self.assertRaises(frappe.ValidationError, procedure.start_procedure, answers)

	def test_an_unknown_answer_code_blocks_the_start(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			answers[first_coded_question(procedure)] = "MAYBE"
			self.assertRaises(frappe.ValidationError, procedure.start_procedure, answers)

	def test_the_saved_template_decides_the_questions(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			for question in read_questions("Clinical Procedure Template", procedure.procedure_template):
				answers.pop(question.name)
			procedure.procedure_template = None
			self.assertRaises(frappe.ValidationError, procedure.start_procedure, answers)
		self.assertEqual(saved_status(procedure), "Pending")

	def test_the_response_names_the_saved_patient(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			procedure.patient = "_Test Allergic Patient"
			procedure.start_procedure(answers)
		response = json.loads(procedure.safety_check)
		self.assertEqual(response["subject"]["reference"], "Patient/_Test Patient")

	def test_a_procedure_cannot_be_saved_with_a_checklist_before_it_starts(self):
		procedure = make_procedure(submit=False)
		procedure.safety_check = json.dumps({"resourceType": "QuestionnaireResponse"})
		procedure.submit()
		self.assertIsNone(procedure.safety_check)

	def test_not_applicable_blocks_the_start_unless_the_question_allows_it(self):
		with self.enabled():
			procedure = make_procedure()
			answers = answer_all(procedure)
			answers[first_coded_question(procedure)] = "NA"
			self.assertRaises(frappe.ValidationError, procedure.start_procedure, answers)
		self.assertEqual(saved_status(procedure), "Pending")

	def test_not_applicable_is_accepted_where_the_question_allows_it(self):
		with self.enabled():
			procedure = make_procedure()
			question = first_coded_question(procedure)
			frappe.db.set_value("Procedure Safety Question", question, "allow_not_applicable", 1)
			answers = answer_all(procedure)
			answers[question] = "NA"
			procedure.start_procedure(answers)
		self.assertEqual(saved_status(procedure), "In Progress")

	def test_medications_need_read_access_to_the_procedure(self):
		procedure = make_procedure()
		with self.set_user("portal-other-user"):
			self.assertRaises(frappe.PermissionError, get_medications, procedure.name)

	def test_a_procedure_cannot_be_submitted_as_started(self):
		with self.enabled():
			procedure = make_procedure(submit=False)
			procedure.status = "In Progress"
			procedure.safety_check = json.dumps({"resourceType": "QuestionnaireResponse"})
			procedure.submit()
		self.assertEqual(saved_status(procedure), "Pending")
		self.assertIsNone(procedure.safety_check)

	def test_the_saved_checklist_cannot_be_changed(self):
		with self.enabled():
			procedure = make_procedure()
			procedure.start_procedure(answer_all(procedure))
		procedure.reload()
		procedure.safety_check = json.dumps({"resourceType": "QuestionnaireResponse"})
		self.assertRaises(frappe.UpdateAfterSubmitError, procedure.save)

	def enabled(self):
		return self.change_settings("Healthcare Settings", {"enable_procedure_safety_check": 1})


def safety_template():
	return frappe.get_doc("Clinical Procedure Template", "_Test Procedure - Safety Check")


def make_procedure(submit=True):
	return create_procedure(safety_template(), "_Test Patient", "_Test Healthcare Practitioner 2", submit)


def answer_all(procedure) -> dict:
	return {
		question.name: "06:00" if question.answer_type == "Text" else "Y"
		for question in get_questions(procedure.procedure_template)
	}


def first_coded_question(procedure) -> str:
	questions = get_questions(procedure.procedure_template)
	return next(question.name for question in questions if question.answer_type != "Text")


def text_question(procedure) -> str:
	questions = get_questions(procedure.procedure_template)
	return next(question.name for question in questions if question.answer_type == "Text")


def saved_status(procedure) -> str:
	return frappe.db.get_value("Clinical Procedure", procedure.name, "status")
