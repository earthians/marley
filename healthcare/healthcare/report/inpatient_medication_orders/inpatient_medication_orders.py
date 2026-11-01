# Copyright (c) 2013, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _

from healthcare.healthcare.doctype.inpatient_medication_entry.inpatient_medication_entry import (
	get_current_healthcare_service_unit,
)


def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	chart = get_chart_data(data)

	return columns, data, None, chart


def get_columns():
	return [
		{
			"fieldname": "patient",
			"fieldtype": "Link",
			"label": "Patient",
			"options": "Patient",
			"width": 200,
		},
		{
			"fieldname": "healthcare_service_unit",
			"fieldtype": "Link",
			"label": "Healthcare Service Unit",
			"options": "Healthcare Service Unit",
			"width": 150,
		},
		{
			"fieldname": "drug",
			"fieldtype": "Link",
			"label": "Drug Code",
			"options": "Item",
			"width": 150,
		},
		{"fieldname": "drug_name", "fieldtype": "Data", "label": "Drug Name", "width": 150},
		{
			"fieldname": "dosage",
			"fieldtype": "Link",
			"label": "Dosage",
			"options": "Prescription Dosage",
			"width": 80,
		},
		{
			"fieldname": "dosage_form",
			"fieldtype": "Link",
			"label": "Dosage Form",
			"options": "Dosage Form",
			"width": 100,
		},
		{"fieldname": "date", "fieldtype": "Date", "label": "Date", "width": 100},
		{"fieldname": "time", "fieldtype": "Time", "label": "Time", "width": 100},
		{"fieldname": "status", "fieldtype": "Data", "label": _("Status"), "width": 100},
		{"fieldname": "stop_reason", "fieldtype": "Small Text", "label": _("Stop Reason"), "width": 180},
		{"fieldname": "is_completed", "fieldtype": "Check", "label": "Is Order Completed", "width": 100},
		{
			"fieldname": "healthcare_practitioner",
			"fieldtype": "Link",
			"label": "Healthcare Practitioner",
			"options": "Healthcare Practitioner",
			"width": 200,
		},
		{
			"fieldname": "inpatient_medication_entry",
			"fieldtype": "Link",
			"label": "Inpatient Medication Entry",
			"options": "Inpatient Medication Entry",
			"width": 200,
		},
		{
			"fieldname": "inpatient_record",
			"fieldtype": "Link",
			"label": "Inpatient Record",
			"options": "Inpatient Record",
			"width": 200,
		},
	]


def get_data(filters=None):
	filters = frappe._dict(filters or {})

	parent = frappe.qb.DocType("Inpatient Medication Order")
	child = frappe.qb.DocType("Inpatient Medication Order Entry")

	query = (
		frappe.qb.from_(parent)
		.inner_join(child)
		.on(child.parent == parent.name)
		.select(
			parent.patient,
			parent.inpatient_record,
			parent.practitioner.as_("healthcare_practitioner"),
			child.drug,
			child.drug_name,
			child.dosage,
			child.dosage_form,
			child.date,
			child.time,
			child.status,
			child.stop_reason,
			child.is_completed,
			child.name.as_("order_entry"),
		)
		.where(parent.docstatus == 1)
	)

	query = get_conditions(query, filters, parent, child)

	data = query.orderby(child.date).orderby(child.time).run(as_dict=True)

	data = get_inpatient_details(data, filters.get("service_unit"))

	return data


def get_conditions(query, filters, parent, child):
	if filters.get("company"):
		query = query.where(parent.company == filters.get("company"))

	if filters.get("from_date") and filters.get("to_date"):
		query = query.where(child.date.between(filters.get("from_date"), filters.get("to_date")))

	if filters.get("patient"):
		query = query.where(parent.patient == filters.get("patient"))

	if not filters.get("show_completed_orders"):
		query = query.where(child.status == "Pending")

	return query


def get_inpatient_details(data, service_unit):
	service_unit_filtered_data = []

	for entry in data:
		entry["healthcare_service_unit"] = get_current_healthcare_service_unit(entry.inpatient_record)

		if entry.status in ("Completed", "Transferred"):
			entry["inpatient_medication_entry"] = get_inpatient_medication_entry(entry.order_entry)

		if service_unit and entry.healthcare_service_unit and service_unit != entry.healthcare_service_unit:
			service_unit_filtered_data.append(entry)

		entry.pop("order_entry", None)

	for entry in service_unit_filtered_data:
		data.remove(entry)

	return data


def get_inpatient_medication_entry(order_entry):
	return frappe.db.get_value("Inpatient Medication Entry Detail", {"against_imoe": order_entry}, "parent")


def get_chart_data(data):
	if not data:
		return None

	labels = ["Pending", "Transferred", "Completed", "Stopped"]
	datasets = []

	status_wise_data = {status: 0 for status in labels}

	for d in data:
		status = d.status or "Pending"
		if status in status_wise_data:
			status_wise_data[status] += 1

	datasets.append(
		{
			"name": "Inpatient Medication Order Status",
			"values": [status_wise_data.get(status) for status in labels],
		}
	)

	chart = {"data": {"labels": labels, "datasets": datasets}, "type": "donut", "height": 300}

	chart["fieldtype"] = "Data"

	return chart
