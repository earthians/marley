# Copyright (c) 2017, ESS LLP and Contributors
# See license.txt


import frappe
from frappe.utils import add_to_date, get_datetime, nowdate, nowtime

from healthcare.healthcare.doctype.service_request.service_request import make_clinical_procedure
from healthcare.tests.utils import HealthcareTestSuite

KNEE_TEMPLATE = "_Test Procedure - Knee Surgery and Rehab"


class TestClinicalProcedure(HealthcareTestSuite):
	def setUp(self):
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]

	def test_disable_procedure_template_item(self):
		procedure_template = create_clinical_procedure_template()
		self.assertTrue(frappe.db.exists("Item", procedure_template.item))

		procedure_template.disabled = True
		procedure_template.save()
		self.assertEqual(frappe.db.get_value("Item", procedure_template.item, "disabled"), 1)

	def test_consumables(self):
		procedure_template = create_template("_Test Procedure - Dressing", consume_stock=1)
		add_consumable(procedure_template)
		procedure = create_procedure(procedure_template, self.patient, self.practitioner)
		result = procedure.start_procedure()
		if result == "insufficient stock":
			procedure.make_material_receipt(submit=True)
			result = procedure.start_procedure()
		self.assertEqual(procedure.status, "In Progress")
		result = procedure.complete_procedure()
		# check consumption
		self.assertTrue(frappe.db.exists("Stock Entry", result))

	def test_start_and_end_time(self):
		procedure_template = create_template("_Test Procedure - Timed", default_duration=3600)
		procedure = create_procedure(procedure_template, self.patient, self.practitioner)
		start = get_datetime(f"{procedure.start_date} {procedure.start_time}")
		self.assertEqual(get_datetime(procedure.planned_end_datetime), add_to_date(start, seconds=3600))

		procedure.start_procedure()
		self.assertEqual(procedure.status, "In Progress")
		self.assertTrue(procedure.actual_start_datetime)

		procedure.complete_procedure()
		self.assertEqual(procedure.status, "Completed")
		self.assertTrue(procedure.actual_end_datetime)

	def test_status_follows_docstatus(self):
		procedure = create_procedure(
			create_clinical_procedure_template(), self.patient, self.practitioner, submit=False
		)
		self.assertEqual(procedure.status, "Draft")

		procedure.submit()
		self.assertEqual(procedure.status, "Pending")

		procedure.cancel()
		self.assertEqual(procedure.status, "Cancelled")

	def test_template_sample_creates_a_sample_collection(self):
		procedure_template = create_template("_Test Procedure - Biopsy", sample="_Test Sample - Blood Sample")
		procedure = create_procedure(procedure_template, self.patient, self.practitioner, submit=False)

		self.assertTrue(frappe.db.exists("Sample Collection", procedure.sample))

	def test_pre_op_tasks_on_submit_and_post_op_tasks_on_complete(self):
		procedure_template = create_template(
			"_Test Procedure - Checklists",
			pre_op_nursing_checklist_template="Discharge checklist",
			post_op_nursing_checklist_template="Discharge checklist",
		)
		procedure = create_procedure(procedure_template, self.patient, self.practitioner)
		self.assertEqual(count_nursing_tasks(procedure), 1)

		frappe.db.set_value("Nursing Task", {"reference_name": procedure.name}, "status", "Completed")
		procedure.start_procedure()
		procedure.complete_procedure()
		self.assertEqual(count_nursing_tasks(procedure), 2)

	def test_service_request_follows_the_procedure(self):
		service_request = create_service_request(self.patient, self.practitioner, quantity=2)
		procedure = make_clinical_procedure(service_request.name)
		procedure.submit()
		self.assertEqual(request_status(service_request), "active-Request Status")

		procedure.start_procedure()
		procedure.complete_procedure()
		self.assertEqual(request_status(service_request), "completed-Request Status")

		procedure.cancel()
		self.assertEqual(request_status(service_request), "active-Request Status")

	def test_last_session_completes_the_service_request_on_submit(self):
		service_request = create_service_request(self.patient, self.practitioner, quantity=1)
		make_clinical_procedure(service_request.name).submit()

		self.assertEqual(request_status(service_request), "completed-Request Status")

	def test_second_draft_from_the_same_service_request_is_refused(self):
		service_request = create_service_request(self.patient, self.practitioner, quantity=2)
		make_clinical_procedure(service_request.name).insert()

		self.assertRaises(frappe.ValidationError, make_clinical_procedure(service_request.name).insert)

	def test_complete_summarises_consumables_invoiced_separately(self):
		procedure_template = create_template("_Test Procedure - Separate Consumables")
		consumable = add_consumable(procedure_template, invoice_separately=1)
		procedure = create_procedure(procedure_template, self.patient, self.practitioner)
		set_selling_price(consumable.item_code, procedure.price_list, 40)

		procedure.start_procedure()
		procedure.complete_procedure()
		procedure.reload()

		self.assertEqual(procedure.consumable_total_amount, 40)
		self.assertIn(consumable.item_name, procedure.consumption_details)
		self.assertTrue(procedure.invoice_separately_as_consumables)


def count_nursing_tasks(procedure):
	return frappe.db.count("Nursing Task", {"reference_name": procedure.name})


def request_status(service_request):
	return frappe.db.get_value("Service Request", service_request.name, "status")


def create_service_request(patient, practitioner, quantity):
	service_request = frappe.get_doc(
		{
			"doctype": "Service Request",
			"order_date": nowdate(),
			"order_time": nowtime(),
			"company": "_Test Company",
			"patient": patient,
			"practitioner": practitioner,
			"status": "draft-Request Status",
			"quantity": quantity,
			"template_dt": "Clinical Procedure Template",
			"template_dn": KNEE_TEMPLATE,
		}
	)
	service_request.insert(ignore_permissions=True)
	service_request.submit()
	return service_request


def set_selling_price(item_code, price_list, rate):
	if not frappe.db.exists("Item Price", {"item_code": item_code, "price_list": price_list}):
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": item_code,
				"price_list": price_list,
				"price_list_rate": rate,
			}
		).insert()


def create_template(name, **fields):
	if frappe.db.exists("Clinical Procedure Template", name):
		template = frappe.get_doc("Clinical Procedure Template", name)
		template.update(fields)
		template.items = []
		return template.save()
	template = frappe.get_doc(
		{
			"doctype": "Clinical Procedure Template",
			"template": name,
			"item_code": name,
			"item_group": "Services",
			"description": name,
			"is_billable": 1,
			"rate": 1000,
			**fields,
		}
	)
	return template.insert()


def add_consumable(procedure_template, invoice_separately=0):
	consumable = create_consumable()
	procedure_template.append(
		"items",
		{
			"item_code": consumable.item_code,
			"qty": 1,
			"uom": consumable.stock_uom,
			"stock_uom": consumable.stock_uom,
			"invoice_separately_as_consumables": invoice_separately,
		},
	)
	procedure_template.save()
	return consumable


def create_consumable():
	if frappe.db.exists("Item", "Syringe"):
		return frappe.get_doc("Item", "Syringe")
	consumable = frappe.new_doc("Item")
	consumable.item_code = "Syringe"
	consumable.item_group = "_Test Item Group"
	consumable.stock_uom = "Nos"
	consumable.valuation_rate = 5.00
	consumable.save()
	return consumable


def create_procedure(procedure_template, patient, practitioner, submit=True):
	procedure = frappe.new_doc("Clinical Procedure")
	procedure.procedure_template = procedure_template.name
	procedure.patient = patient
	procedure.practitioner = practitioner
	procedure.consume_stock = procedure_template.consume_stock
	procedure.items = procedure_template.items
	procedure.company = "_Test Company"
	procedure.warehouse = "_Test Warehouse - _TC"
	procedure.start_date = frappe.utils.getdate()
	procedure.start_time = frappe.utils.nowtime()
	if submit:
		procedure.submit()
	else:
		procedure.insert()
	return procedure


def create_clinical_procedure_template():
	if frappe.db.exists("Clinical Procedure Template", "Knee Surgery and Rehab"):
		return frappe.get_doc("Clinical Procedure Template", "Knee Surgery and Rehab")

	template = frappe.new_doc("Clinical Procedure Template")
	template.template = "Knee Surgery and Rehab"
	template.item_code = "Knee Surgery and Rehab"
	template.item_group = "Services"
	template.is_billable = 1
	template.description = "Knee Surgery and Rehab"
	template.rate = 50000
	template.save()

	return template
