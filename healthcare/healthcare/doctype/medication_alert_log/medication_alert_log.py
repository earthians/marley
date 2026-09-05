# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html

from healthcare.healthcare.doctype.medication.medication import expand_many

# most serious first
SEVERITY_ORDER = ["Contraindicated", "Major", "Minor"]

# what a severity does, weakest first. Block refuses the order, Warn is shown and the order
# saves, Notify is only ever an indicator
ACTIONS = ["Notify", "Warn", "Block"]

# a recorded allergy lines up with these severities, so the same actions govern both
ALLERGY_SEVERITY = {"Severe": "Contraindicated", "Moderate": "Major", "Mild": "Minor"}

ACTIVE_REQUEST_STATUS = ["active-Medication Request Status", "on-hold-Medication Request Status"]


class MedicationAlertLog(Document):
	"""A record of an alert raised at prescribing time.

	Written by the safety checker and never afterwards. No role holds write or delete
	permission, and these guards hold for code that ignores permissions as well, because a log
	that can be edited after the fact is not evidence of anything.
	"""

	def validate(self):
		if self.get_doc_before_save():
			frappe.throw(_("A medication alert log cannot be changed"), title=_("Read Only"))

	def on_trash(self):
		frappe.throw(_("A medication alert log cannot be deleted"), title=_("Read Only"))


def allergy_alert(medication, allergen):
	return frappe._dict(
		kind="Allergy",
		# a severity nobody recorded is treated as the most serious, never downgraded
		severity=ALLERGY_SEVERITY.get(allergen.severity, SEVERITY_ORDER[0]),
		subject=medication,
		against=allergen.allergy,
		advice=allergen.reaction or "",
		source=allergen.name,
		source_doctype="Patient Allergy",
		message=_("{0}: the patient has a recorded allergy to {1}").format(medication, allergen.allergy),
		action="Notify",
	)


def interaction_alert(rule, medication, other):
	return frappe._dict(
		kind="Interaction",
		severity=rule.severity,
		subject=medication,
		against=other,
		advice=rule.advice or "",
		source=rule.name,
		source_doctype="Medication Interaction",
		message=_("{0} interacts with {1}").format(medication, other),
		action="Notify",
	)


def rank(alert):
	"""Lower is more serious"""
	return SEVERITY_ORDER.index(alert.severity)


def check(patient: str, medications: list[str]) -> list[frappe._dict]:
	"""Allergy and interaction alerts for medications being ordered for a patient"""
	settings = get_settings()
	if not settings.enabled:
		return []

	alerts = MedicationSafetyCheck(patient, medications).run()

	for alert in alerts:
		alert.action = settings.actions[alert.severity]

	return alerts


def get_settings():
	return frappe._dict(
		enabled=bool(get_setting("enable_medication_alerts")),
		actions=get_alert_actions(),
		record_from=get_setting("record_alerts_from"),
	)


def get_setting(fieldname):
	return frappe.db.get_single_value("Healthcare Settings", fieldname)


def get_alert_actions():
	"""A blank action is only reachable while the feature is off, since every action is
	mandatory once it is on. Fall back to the quietest rather than guess"""
	return {severity: get_setting(action_fieldname(severity)) or ACTIONS[0] for severity in SEVERITY_ORDER}


def action_fieldname(severity):
	return f"{severity.lower()}_alert_action"


class MedicationSafetyCheck:
	def __init__(self, patient, medications):
		self.patient = patient
		self.candidates = [name for name in dict.fromkeys(medications) if name]
		self.current = [n for n in get_current_medications(patient) if n not in self.candidates]
		self.expansions = expand_many(self.candidates + self.current)

	def run(self):
		alerts = self.allergy_alerts() + self.interaction_alerts()
		return sorted(alerts, key=lambda alert: (rank(alert), alert.subject, alert.against))

	def allergy_alerts(self):
		allergens = get_patient_allergens(self.patient)

		return [
			allergy_alert(candidate, allergen)
			for candidate in self.candidates
			for allergen in allergens
			if allergen.interactant in self.expansions[candidate]
		]

	def interaction_alerts(self):
		"""One alert per pair. A broad rule and a narrow one can both match, so the most
		severe wins rather than the prescriber seeing the same pair twice"""
		rules = self.get_rules()
		most_severe = {}

		for first, second in self.pairs():
			for rule in self.matching_rules(rules, first, second):
				alert = interaction_alert(rule, first, second)
				held = most_severe.get((first, second))
				if not held or rank(alert) < rank(held):
					most_severe[(first, second)] = alert

		return list(most_severe.values())

	def pairs(self):
		for index, candidate in enumerate(self.candidates):
			for other in self.candidates[index + 1 :] + self.current:
				yield candidate, other

	def get_rules(self):
		names = {name for interactants in self.expansions.values() for _, name in interactants}
		if not names:
			return []

		return frappe.get_all(
			"Medication Interaction",
			filters={"disabled": 0, "interactant_a": ("in", names), "interactant_b": ("in", names)},
			fields=[
				"name",
				"interactant_a_type",
				"interactant_a",
				"interactant_b_type",
				"interactant_b",
				"severity",
				"advice",
			],
		)

	def matching_rules(self, rules, first, second):
		left, right = self.expansions[first], self.expansions[second]

		for rule in rules:
			a = (rule.interactant_a_type, rule.interactant_a)
			b = (rule.interactant_b_type, rule.interactant_b)
			if (a in left and b in right) or (a in right and b in left):
				yield rule


def get_current_medications(patient):
	if not patient:
		return []

	names = frappe.get_all(
		"Medication Request",
		filters={"patient": patient, "docstatus": 1, "status": ("in", ACTIVE_REQUEST_STATUS)},
		pluck="medication",
		distinct=True,
	)
	return [name for name in names if name]


def get_patient_allergens(patient):
	"""Active allergies that name a substance a prescription can be checked against"""
	if not patient:
		return []

	allergies = frappe.get_all(
		"Patient Allergy",
		filters={"patient": patient, "status": "Active"},
		fields=["name", "allergy", "severity", "reaction"],
	)
	if not allergies:
		return []

	substances = get_allergen_substances([allergy.allergy for allergy in allergies])

	for allergy in allergies:
		allergy.interactant = substances.get(allergy.allergy)

	return [allergy for allergy in allergies if allergy.interactant]


def get_allergen_substances(allergens):
	rows = frappe.get_all(
		"Allergy",
		filters={"name": ("in", allergens), "disabled": 0},
		fields=["name", "substance_type", "substance"],
	)
	return {row.name: (row.substance_type, row.substance) for row in rows if row.substance}


def check_document(doc, medications):
	"""Run the check for a document that orders or administers medication.

	A blocked alert refuses the save outright. Anything shown is parked for
	`log_document_alerts` to write once the document has saved.
	"""
	alerts = check(doc.patient, medications)
	blocked = [alert for alert in alerts if alert.action == "Block"]

	if blocked:
		frappe.throw(as_html(blocked), title=_("Medication Blocked"))

	warnings = [alert for alert in alerts if alert.action == "Warn"]
	if warnings:
		frappe.msgprint(as_html(warnings), title=_("Medication Alerts"), indicator="orange")

	doc.flags.medication_alerts = alerts


def log_document_alerts(doc):
	"""Written once the document has saved, so the reference points at a row that exists.

	A blank Record Alerts From means the site keeps no log.
	"""
	record_from = get_settings().record_from
	if not record_from:
		return

	threshold = SEVERITY_ORDER.index(record_from)

	for alert in doc.flags.get("medication_alerts") or []:
		if rank(alert) <= threshold:
			write_log(doc, alert)


def write_log(doc, alert):
	frappe.get_doc(
		{
			"doctype": "Medication Alert Log",
			"patient": doc.patient,
			"kind": alert.kind,
			"severity": alert.severity,
			"action": alert.action,
			"medication": alert.subject,
			"conflicts_with": alert.against,
			"alert_message": alert.message,
			"source_doctype": alert.source_doctype,
			"source_name": alert.source,
			"reference_doctype": doc.doctype,
			"reference_name": doc.name,
			"raised_for": frappe.session.user,
		}
	).insert(ignore_permissions=True)


def as_html(alerts):
	items = "".join(f"<li>{as_item(alert)}</li>" for alert in alerts)
	return f"<ul>{items}</ul>"


def as_item(alert):
	# advice is authored by an administrator and rendered into a dialog, so escape it
	advice = f"<br><small>{escape_html(alert.advice)}</small>" if alert.advice else ""
	return f"<b>{escape_html(alert.severity)}</b> &mdash; {escape_html(alert.message)}{advice}"


@frappe.whitelist()
def get_alerts(patient: str, medications: str | list[str]):
	frappe.has_permission("Patient", doc=patient, throw=True)

	if isinstance(medications, str):
		medications = frappe.parse_json(medications)

	return {"alerts": check(patient, medications)}


def get_allergy_flagged(patient, medications):
	"""Which of these medications the patient has a recorded allergy to.

	Used to mark the prescriber's search results. Allergy only: an interaction depends on what
	else is already prescribed, which a dropdown row cannot express.
	"""
	allergens = {allergen.interactant for allergen in get_patient_allergens(patient)}
	if not allergens or not medications:
		return set()

	expansions = expand_many(list(medications))
	return {name for name, interactants in expansions.items() if interactants & allergens}
