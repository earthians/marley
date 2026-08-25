# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from healthcare.healthcare.api.nursing_common import default_company

# An order in any of these states is done with, so it is not part of the plan.
CLOSED_ORDER_CODES = ("completed", "revoked", "cancelled", "stopped", "entered-in-error", "unknown")

ORDER_SOURCES = (
	("Service Request", "Request Status", "template_dn", "order_description"),
	("Medication Request", "Medication Request Status", "medication_item", "order_description"),
)


def closed_status_values(code_system):
	"""Statuses are Code Values, so the closed ones are looked up, not guessed."""
	return frappe.get_all(
		"Code Value",
		filters={"code_system": code_system, "code_value": ["in", CLOSED_ORDER_CODES]},
		pluck="name",
	)


class ActiveOrders:
	"""What has been ordered for this patient and is not finished with."""

	def __init__(self, patient):
		self.patient = patient

	def as_list(self):
		return [order for source in ORDER_SOURCES for order in self.orders_from(*source)]

	def orders_from(self, doctype, code_system, label_field, description_field):
		closed = closed_status_values(code_system)
		filters = {"patient": self.patient, "docstatus": 1}
		if closed:
			filters["status"] = ["not in", closed]

		rows = frappe.get_all(
			doctype,
			filters=filters,
			fields=[
				"name",
				"status",
				"order_date",
				"practitioner",
				label_field + " as label",
				description_field + " as description",
			],
			order_by="order_date desc",
		)
		return [{**row, "order_doctype": doctype} for row in rows]


@frappe.whitelist()
def get_active_orders(patient):
	return ActiveOrders(patient).as_list()


@frappe.whitelist()
def get_care_plan(patient):
	"""The live plan for this patient's admission, if a nurse has started one."""
	plans = frappe.get_all(
		"Nursing Care Plan",
		filters={"patient": patient, "status": "Active", "docstatus": ["<", 2]},
		fields=["name", "started_by", "started_on"],
		order_by="started_on desc",
		limit=1,
	)
	if not plans:
		return None

	plan = plans[0]
	plan["goals"] = frappe.get_all(
		"Care Goal",
		filters={"parent": plan.name},
		fields=["name", "goal", "target_date", "status", "notes"],
		order_by="idx asc",
	)
	return plan


@frappe.whitelist()
def start_care_plan(patient, goals, reference_doctype=None, reference_name=None):
	"""Goals are set when a nurse first takes the patient over."""
	if isinstance(goals, str):
		goals = frappe.parse_json(goals)

	written = [goal for goal in goals or [] if str(goal.get("goal") or "").strip()]
	if not written:
		frappe.throw(_("Set at least one goal to start the plan"))

	plan = frappe.get_doc(
		{
			"doctype": "Nursing Care Plan",
			"patient": patient,
			"inpatient_record": frappe.db.get_value("Patient", patient, "inpatient_record"),
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
			"company": default_company(),
			"goals": written,
		}
	)
	plan.insert(ignore_permissions=True)
	return plan.name


@frappe.whitelist()
def add_goal(plan, goal, target_date=None):
	document = frappe.get_doc("Nursing Care Plan", plan)
	document.append("goals", {"goal": goal, "target_date": target_date})
	document.save(ignore_permissions=True)
	return document.name


@frappe.whitelist()
def set_goal_status(plan, goal, status, notes=None):
	document = frappe.get_doc("Nursing Care Plan", plan)
	for row in document.goals:
		if row.name == goal:
			row.status = status
			if notes:
				row.notes = notes
			break
	else:
		frappe.throw(_("That goal is not on this plan"))

	document.save(ignore_permissions=True)
	return status
