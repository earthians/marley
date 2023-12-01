# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext.stock.get_item_details import get_item_price
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	create_inpatient_record,
)


class TreatmentCounselling(Document):
	def before_insert(self):
		if self.customer:
			self.price_list = frappe.db.get_value(
				"Customer", self.customer, "default_price_list"
			)

		if not self.price_list:
			self.price_list = frappe.db.get_single_value(
				"Selling Settings", "selling_price_list"
			)

	def validate(self):
		if self.status == "Active":
			active_tpc = frappe.db.exists(
				"Treatment Counselling",
				{
					"status": "Active",
					"docstatus": 1,
					"inpatient_record": self.inpatient_record,
					"admission_encounter": self.admission_encounter,
					"name": ["!=", self.name],
				},
			)

			if active_tpc:
				frappe.throw(
					_("Active Treatment Counselling {0} already exist for encounter {1}").format(
						frappe.bold(
							frappe.utils.get_link_to_form("Treatment Counselling", active_tpc)
						),
						frappe.bold(
							frappe.utils.get_link_to_form(
								"Patient Encounter", self.admission_encounter
							)
						),
					)
				)
		set_treatment_plan_template_items(self)
		set_total_amount(self)

		if self.paid_amount:
			self.outstanding_amount = self.amount - self.paid_amount
		else:
			self.outstanding_amount = self.amount


	def after_insert(self):
		if self.admission_encounter:  # Update encounter
			frappe.db.set_value(
				"Patient Encounter",
				self.admission_encounter,
				"inpatient_status",
				"Treatment Counselling Created",
			)

	def on_update_after_submit(self):
		doc_before_save = self.get_doc_before_save()
		if (
			self.status == "Closed"
			and doc_before_save.status != "Closed"
			and self.admission_encounter
		):
			frappe.db.set_value(
				"Patient Encounter", self.admission_encounter, "inpatient_status", ""
			)

		if self.paid_amount:
			self.outstanding_amount = self.amount - self.paid_amount
		else:
			self.outstanding_amount = self.amount

	def on_cancel(self):
		if self.admission_encounter:
			frappe.db.set_value("Patient Encounter", self.admission_encounter, "inpatient_status", "")


def set_treatment_plan_template_items(doc):
	if (
		doc.treatment_plan_template
		and not doc.treatment_plan_template_items
	):
		item_list = get_encounter_items(doc.admission_encounter)

		template_item_list = frappe.get_all(
			"Treatment Plan Template Item", {"parent": doc.treatment_plan_template}, ["type", "template", "qty", "instructions"]
		)
		item_list.extend(template_item_list)
		medication_list = frappe.get_all(
			"Drug Prescription", {"parent": doc.treatment_plan_template}, ["*"]
		)
		item_list.extend(medication_list)
		for item in item_list:
			# print(item)
			args = {"price_list": doc.price_list}
			if item.get("drug_code"):
				item_details = get_item_price(args, item.get("drug_code"))
			else:
				item_details = get_item_price(args, item.get("template"))
			if item_details:
				item_price = [
					element for tupl in item_details for element in tupl
				][1]
				item["amount"] = item_price

			if item.get("drug_code"):
				if not any(d.get("drug_code") == item.get("drug_code") for d in doc.treatment_plan_template_items):
					doc.append("treatment_plan_template_items", {
						"type": "Medication",
						"template": item.get("medication"),
						"drug_code": item.get("drug_code"),
						"drug_name": item.get("drug_name"),
						"strength": item.get("strength"),
						"strength_uom":item.get("strength_uom"),
						"dosage_form": item.get("dosage_form"),
						"dosage": item.get("dosage"),
						"period": item.get("period"),
						"number_of_repeats_allowed": item.get("number_of_repeats_allowed"),
						"service_request": item.get("medication_request", ""),
					})
			else:
				if not any(d.get("template") == item["template"] for d in doc.treatment_plan_template_items):
					doc.append("treatment_plan_template_items", {
						"type":item.get("type"),
						"template": item.get("template"),
						"qty": item.get("qty", 1),
						"amount": item.get("amount", 0),
						"instructions": item.get("instructions", ""),
						"service_request": item.get("service_request", ""),
					})
		if doc.admission_service_unit_type:
			su_item, su_rate = frappe.db.get_value("Healthcare Service Unit Type", doc.admission_service_unit_type, ["item", "rate"])
			if su_item and su_rate:
				doc.append("treatment_plan_template_items", {"type":"Item", "template": su_item, "qty": doc.expected_length_of_stay, "amount": su_rate})


def set_total_amount(doc):
	total_price = 0
	for item in doc.treatment_plan_template_items:
		if item.amount:
			total_price += item.amount

	doc.amount = total_price


@frappe.whitelist()
def create_ip_from_treatment_counselling(admission_order, treatment_counselling):
	ip_name = create_inpatient_record(admission_order)
	frappe.db.set_value(
		"Treatment Counselling", treatment_counselling, {"status": "Completed", "inpatient_record": ip_name}
	)
	if ip_name:
		doc = frappe.get_doc("Treatment Counselling", treatment_counselling)
		for item in doc.treatment_plan_template_items:
			if not item.service_request:
				if item.get("type") == "Medication":
					medication = frappe.get_doc("Medication", item.get("template"))
					order = get_order_details(doc, medication, item, ip_name, True)
					order.insert(ignore_permissions=True, ignore_mandatory=True)
					order.submit()
					item.service_request = order.name
				elif item.get("type") in ["Observation Template", "Lab Test Template", "Therapy Type", "Clinical Procedure Template"]:
					lab_template = frappe.get_doc(item.get("type"), item.get("template"))
					order = get_order_details(doc, lab_template, item, ip_name)
					order.insert(ignore_permissions=True, ignore_mandatory=True)
					order.submit()
					item.service_request = order.name
		doc.save("Update")


@frappe.whitelist()
def create_payment_entry(treatment_counselling):
	payment_entry = frappe.db.exists("Payment Entry", {"treatment_counselling": treatment_counselling, "docstatus": ["!=", 2]})
	if payment_entry:
		return payment_entry
	treatment_counselling_doc = frappe.get_doc("Treatment Counselling", treatment_counselling)
	payment_entry_doc = frappe.new_doc("Payment Entry")
	payment_entry_doc.update({
		"payment_type": "Receive",
		"party_type":"Customer",
		"party" : treatment_counselling_doc.customer,
		"treatment_counselling" : treatment_counselling,
		"paid_amount": treatment_counselling_doc.outstanding_amount,
		"received_amount": treatment_counselling_doc.outstanding_amount,
		"target_exchange_rate": 1,
	})

	payment_entry_doc.insert(ignore_mandatory = True)
	return payment_entry_doc.name

def get_encounter_items(encounter):
	item_list = []
	if encounter:
		encounter_doc = frappe.get_doc("Patient Encounter", encounter)
		for lab_presc in encounter_doc.lab_test_prescription:
				item_list.append({
					"template": lab_presc.get("lab_test_code"),
					"type": "Lab Test Template",
					"service_request": lab_presc.get("service_request"),
				})
		for pro_pres in encounter_doc.procedure_prescription:
				item_list.append({
					"template": pro_pres.get("procedure"),
					"type": "Clinical Procedure Template",
					"service_request": pro_pres.get("service_request"),
				})
		for ther in encounter_doc.therapies:
				item_list.append({
					"template": ther.get("therapy_type"),
					"type": "Therapy Type",
					"service_request": ther.get("service_request"),
				})
		for obs in encounter_doc.observations:
				item_list.append({
					"template": obs.get("observation_template"),
					"type": "Observation Template",
					"service_request": obs.get("service_request"),
				})
		for drug in encounter_doc.drug_prescription:
			item_list.append({
				"medication": drug.get("medication"),
				"drug_code": drug.get("drug_code"),
				"drug_name": drug.get("drug_name"),
				"strength": drug.get("strength"),
				"strength_uom":drug.get("strength_uom"),
				"dosage_form": drug.get("dosage_form"),
				"dosage": drug.get("dosage"),
				"period": drug.get("period"),
				"number_of_repeats_allowed": drug.get("number_of_repeats_allowed"),
				"medication_request": drug.get("medication_request"),
			})
	return item_list


def get_order_details(doc, template_doc, line_item, ip_name, medication_request=False):
	order = frappe.get_doc(
		{
			"doctype": "Medication Request" if medication_request else "Service Request",
			"order_date": frappe.utils.nowdate(),
			"order_time": frappe.utils.nowtime(),
			"company": doc.company,
			"status": "Draft",
			"patient": doc.get("patient"),
			"practitioner": doc.primary_practitioner,
			"source_doc": "Inpatient Record",
			"order_group": ip_name,
			"sequence": line_item.get("sequence"),
			"patient_care_type": template_doc.get("patient_care_type"),
			"intent": line_item.get("intent"),
			"priority": line_item.get("priority"),
			"quantity": line_item.get_quantity() if line_item.get("doctype") == "Drug Prescription" else 1,
			"dosage": line_item.get("dosage"),
			"dosage_form": line_item.get("dosage_form"),
			"period": line_item.get("period"),
			"expected_date": line_item.get("expected_date"),
			"as_needed": line_item.get("as_needed"),
			"staff_role": template_doc.get("staff_role"),
			"note": line_item.get("note"),
			"patient_instruction": line_item.get("patient_instruction"),
			"medical_code": template_doc.get("medical_code"),
			"medical_code_standard": template_doc.get("medical_code_standard"),
		}
	)

	if not line_item.get("description"):
		if template_doc.doctype == "Lab Test Template":
			description = template_doc.get("lab_test_description")
		else:
			description = template_doc.get("description")
	else:
		description = line_item.get("description")

	if template_doc.doctype == "Clinical Procedure Template":
		order.update(
			{
			"referred_to_practitioner": line_item.get("practitioner"),
			"ordered_for": line_item.get("date"),
			}
		)
	elif template_doc.doctype == "Healthcare Activity":
		order.update(
			{
			"repeat_in_every": line_item.get("repeat_in_every"),
			}
		)
	if medication_request:
		order.update(
			{
				"source_dt": "Inpatient Record",
				"medication": template_doc.name,
				"number_of_repeats_allowed": line_item.get("number_of_repeats_allowed"),
				"medication_item": line_item.get("drug_code") if line_item.get("drug_code") else "",
				"healthcare_activity": line_item.get("healthcare_activity") if line_item.get("healthcare_activity") else "",
			}
		)
	else:
		order.update(
			{
				"template_dt": template_doc.doctype,
				"template_dn": template_doc.name
			}
		)

	order.update({"order_description": description})
	return order
