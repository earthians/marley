# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import escape_html, get_fullname, get_system_timezone, now_datetime

from healthcare.healthcare.api.nursing_common import ChartAccess
from healthcare.healthcare.doctype.medication_alert_log.medication_alert_log import get_current_medications


@frappe.whitelist(methods=["GET"])
def get_safety_questions(procedure: str) -> list[dict]:
	frappe.has_permission("Clinical Procedure", "write", procedure, throw=True)
	template = frappe.db.get_value("Clinical Procedure", procedure, "procedure_template")
	return get_questions(template)


@frappe.whitelist(methods=["GET"])
def get_medications(procedure: str) -> list[str]:
	frappe.has_permission("Clinical Procedure", "read", procedure, throw=True)
	patient = frappe.db.get_value("Clinical Procedure", procedure, "patient")
	ChartAccess(patient, "Clinical Procedure", procedure).to_read()
	return get_current_medications(patient)


def get_questions(procedure_template: str | None) -> list[dict]:
	if not frappe.db.get_single_value("Healthcare Settings", "enable_procedure_safety_check"):
		return []
	questions = read_questions("Healthcare Settings", "Healthcare Settings")
	if procedure_template:
		questions += read_questions("Clinical Procedure Template", procedure_template)
	sections = get_sections()
	return sorted(questions, key=lambda question: sections.index(question.section))


def read_questions(parenttype: str, parent: str) -> list[dict]:
	return frappe.get_all(
		"Procedure Safety Question",
		filters={"parenttype": parenttype, "parent": parent, "enabled": 1},
		fields=["name", "section", "question", "answer_type"],
		order_by="idx",
	)


def get_sections() -> list[str]:
	return frappe.get_meta("Procedure Safety Question").get_options("section").split("\n")


def build_response(procedure, answers: dict | None) -> dict | None:
	questions = get_questions(procedure.procedure_template)
	if not questions:
		return None
	answers = answers or {}
	return {
		"resourceType": "QuestionnaireResponse",
		"meta": {"versionId": "1"},
		"status": "completed",
		"subject": {"reference": f"Patient/{procedure.patient}", "display": procedure.patient_name},
		"authored": now_datetime().replace(tzinfo=ZoneInfo(get_system_timezone())).isoformat(),
		"author": get_author(frappe.session.user),
		"item": [make_section_item(section, questions, answers) for section in used_sections(questions)],
	}


def used_sections(questions: list[dict]) -> list[str]:
	return list(dict.fromkeys(question.section for question in questions))


def make_section_item(section: str, questions: list[dict], answers: dict) -> dict:
	return {
		"linkId": frappe.scrub(section),
		"text": section,
		"item": [
			make_question_item(question, answers.get(question.name))
			for question in questions
			if question.section == section
		],
	}


def make_question_item(question: dict, answer: str | None) -> dict:
	answer = (answer or "").strip() if isinstance(answer, str) else ""
	if not answer:
		frappe.throw(
			_("Answer the safety question: {0}").format(escape_html(question.question)),
			title=_("Safety Check"),
		)
	value = {"valueString": answer} if question.answer_type == "Text" else make_coding(question, answer)
	return {"linkId": question.name, "text": question.question, "answer": [value]}


def make_coding(question: dict, code: str) -> dict:
	if code == "N":
		frappe.throw(
			_("The procedure cannot start while the answer is No: {0}").format(
				escape_html(question.question)
			),
			title=_("Safety Check"),
		)
	displays = {"Y": "Yes", "NA": "not applicable"}
	if code not in displays:
		frappe.throw(_("Invalid answer for the safety question: {0}").format(escape_html(question.question)))
	system = "http://terminology.hl7.org/CodeSystem/v2-0532"
	return {"valueCoding": {"system": system, "code": code, "display": displays[code]}}


def get_author(user: str) -> dict:
	author = {"identifier": {"value": user}, "display": get_fullname(user)}
	practitioner = frappe.db.get_value("Healthcare Practitioner", {"user_id": user}, "name")
	if practitioner:
		author["reference"] = f"Practitioner/{practitioner}"
	return author
