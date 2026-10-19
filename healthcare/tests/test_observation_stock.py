# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import nowdate, nowtime

from healthcare.healthcare.doctype.observation.observation import set_observation_status
from healthcare.healthcare.doctype.observation.observation_consumables import (
	get_service_unit_type,
	issued,
)
from healthcare.healthcare.doctype.sample_collection.test_sample_collection import create_lab_sample_leaf
from healthcare.tests.test_observation_consumables import (
	BLOOD,
	LABEL,
	NEEDLE,
	WAREHOUSE,
	collection_for,
	consuming_template,
	make_stock_item,
	receive,
	stock_qty,
)
from healthcare.tests.utils import HealthcareTestSuite

REAGENT, TUBE = "_Test Consumable Reagent", "_Test Consumable Tube"
ANALYSER = "_Test Consumables Analyser"
LAB_STORE, PICKED_STORE = "_Test Warehouse 1 - _TC", "Finished Goods - _TC"


class TestObservationStock(HealthcareTestSuite):
	def setUp(self):
		for item in (REAGENT, TUBE, LABEL, NEEDLE):
			make_stock_item(item)
			receive(item, 5)
		make_unit_type(ANALYSER)

	def test_observation_takes_only_the_observation_stage_items(self):
		observation = new_observation(reagent_template("Stock Haemoglobin"))

		self.assertEqual([(row.item_code, row.qty) for row in observation.consumables], [(REAGENT, 2)])

	def test_approving_issues_the_items_and_cancelling_keeps_them_issued(self):
		observation = new_observation(reagent_template("Stock Platelets"), warehouse=WAREHOUSE)
		before = stock_qty(REAGENT)

		observation.submit()
		observation.cancel()

		self.assertEqual(frappe.db.get_value("Stock Entry", observation.stock_entry, "docstatus"), 1)
		self.assertEqual(stock_qty(REAGENT), before - 2)

	def test_the_only_unit_of_the_type_is_picked_with_its_warehouse(self):
		# Its own type, so units other tests make cannot make the choice ambiguous.
		make_unit_type("_Test Consumables Coagulometer")
		unit = make_unit("_Test Consumables Coagulometer A", "_Test Consumables Coagulometer")

		observation = new_observation(
			reagent_template("Stock ESR", unit_type="_Test Consumables Coagulometer")
		)

		self.assertEqual(observation.service_unit, unit)
		self.assertEqual(observation.warehouse, WAREHOUSE)

	def test_a_unit_of_another_type_cannot_perform_it(self):
		make_unit_type("_Test Consumables Scanner")
		scanner = make_unit("_Test Consumables Scanner A", "_Test Consumables Scanner")
		template = reagent_template("Stock Reticulocytes", unit_type=ANALYSER)

		with self.assertRaises(frappe.ValidationError):
			new_observation(template, service_unit=scanner)

	def test_the_service_request_type_overrides_the_template_type(self):
		make_unit_type("_Test Consumables Ultrasound")
		ultrasound = make_unit("_Test Consumables Ultrasound A", "_Test Consumables Ultrasound")
		analyser = make_unit("_Test Consumables Analyser C", ANALYSER)
		template = reagent_template("Stock Doppler", unit_type=ANALYSER)
		request = service_request_for(template, "_Test Consumables Ultrasound")

		self.assertEqual(get_service_unit_type(template.name, request), "_Test Consumables Ultrasound")
		new_observation(template, service_request=request, service_unit=ultrasound)
		with self.assertRaises(frappe.ValidationError):
			new_observation(template, service_request=request, service_unit=analyser)

	def test_an_automatic_warehouse_follows_a_newly_chosen_unit(self):
		frappe.db.set_value("Company", "_Test Company", "default_warehouse", WAREHOUSE)
		observation = new_observation(reagent_template("Stock Bilirubin"))
		self.assertEqual(observation.warehouse, WAREHOUSE)

		observation.service_unit = make_unit("_Test Consumables Analyser D", ANALYSER, LAB_STORE)
		observation.save()

		self.assertEqual(observation.warehouse, LAB_STORE)

	def test_a_warehouse_staff_picked_is_kept_when_the_unit_changes(self):
		observation = new_observation(reagent_template("Stock Albumin"), warehouse=PICKED_STORE)

		observation.service_unit = make_unit("_Test Consumables Analyser E", ANALYSER, LAB_STORE)
		observation.save()

		self.assertEqual(observation.warehouse, PICKED_STORE)

	def test_an_automatic_collection_warehouse_follows_the_collection_point(self):
		frappe.db.set_value("Company", "_Test Company", "default_warehouse", WAREHOUSE)
		doc = collection_for(consuming_template("Stock Globulin", BLOOD), warehouse=None)

		doc.collection_point = make_unit("_Test Consumables Draw Room A", ANALYSER, LAB_STORE)
		doc.save()

		self.assertEqual(doc.warehouse, LAB_STORE)

	def test_a_collection_warehouse_staff_picked_is_kept(self):
		doc = collection_for(consuming_template("Stock Protein", BLOOD), warehouse=PICKED_STORE)

		doc.collection_point = make_unit("_Test Consumables Draw Room B", ANALYSER, LAB_STORE)
		doc.save()

		self.assertEqual(doc.warehouse, PICKED_STORE)

	def test_a_corrected_result_carries_the_original_issue(self):
		template = reagent_template("Stock Correction")
		original = new_observation(template, warehouse=WAREHOUSE)
		set_observation_status(original.name, "Approved")
		before = stock_qty(REAGENT)

		set_observation_status(original.name, "Rejected", reason="Wrong unit typed")
		replacement = replacement_of(template)
		set_observation_status(replacement.name, "Approved")

		self.assertEqual(replacement.stock_entry, original.reload().stock_entry)
		self.assertEqual(stock_qty(REAGENT), before)

	def test_a_result_with_every_quantity_set_to_zero_is_approved(self):
		observation = new_observation(reagent_template("Stock Zero Quantity"), warehouse=WAREHOUSE)
		observation.consumables[0].qty = 0
		observation.save()

		observation.submit()

		self.assertEqual(observation.docstatus, 1)
		self.assertFalse(observation.stock_entry)

	def test_a_corrected_results_issued_consumables_cannot_change(self):
		replacement = self.corrected("Stock Correction Locked")
		replacement.consumables[0].qty = 1

		with self.assertRaises(frappe.ValidationError):
			replacement.save()

	def test_a_corrected_result_cannot_drop_the_issue_it_carries(self):
		replacement = self.corrected("Stock Correction Unlinked")
		replacement.stock_entry = None

		with self.assertRaises(frappe.ValidationError):
			replacement.save()

	def test_a_result_cannot_claim_an_issue_it_did_not_make(self):
		issued_elsewhere = self.corrected("Stock Correction Source").stock_entry
		observation = new_observation(reagent_template("Stock Unissued Claim"), warehouse=WAREHOUSE)
		observation.stock_entry = issued_elsewhere

		with self.assertRaises(frappe.ValidationError):
			observation.save()

	def test_a_corrected_result_keeps_its_warehouse_when_the_unit_changes(self):
		# The default makes the warehouse look automatic, so it would otherwise follow the unit.
		frappe.db.set_value("Company", "_Test Company", "default_warehouse", WAREHOUSE)
		replacement = self.corrected("Stock Correction Unit")
		replacement.service_unit = make_unit("_Test Consumables Analyser D", ANALYSER, LAB_STORE)

		replacement.save()

		self.assertEqual(replacement.warehouse, WAREHOUSE)

	def test_rows_alike_but_for_a_batch_can_be_compared(self):
		rows = [
			frappe._dict(item_code=REAGENT, qty=1, batch_no="_Test Batch"),
			frappe._dict(item_code=REAGENT, qty=1, batch_no=None),
		]

		issued(frappe._dict(consume_stock=1, warehouse=WAREHOUSE, consumables=rows))

	def corrected(self, template_name):
		template = reagent_template(template_name)
		original = new_observation(template, warehouse=WAREHOUSE)
		set_observation_status(original.name, "Approved")
		set_observation_status(original.name, "Rejected", reason="Wrong unit typed")
		return replacement_of(template)

	def test_a_repeated_test_issues_its_consumables_again(self):
		template = reagent_template("Stock Repeat")
		original = new_observation(template, warehouse=WAREHOUSE)
		set_observation_status(original.name, "Approved")
		before = stock_qty(REAGENT)

		set_observation_status(original.name, "Rejected", reason="Clotted sample", repeat_test=True)
		replacement = replacement_of(template)
		set_observation_status(replacement.name, "Approved")

		self.assertNotEqual(replacement.reload().stock_entry, original.reload().stock_entry)
		self.assertEqual(stock_qty(REAGENT), before - 2)

	def test_a_component_follows_its_parent_service_unit(self):
		unit = make_unit("_Test Consumables Analyser B", ANALYSER)
		parent = new_observation(reagent_template("Stock Panel Parent"), service_unit=unit)

		component = new_observation(reagent_template("Stock Panel Leaf"), parent_observation=parent.name)

		self.assertEqual(component.service_unit, unit)

	def test_a_component_needing_other_equipment_takes_its_own_unit(self):
		make_unit_type("_Test Consumables Spectrometer")
		analyser = make_unit("_Test Consumables Analyser E", ANALYSER)
		spectrometer = make_unit("_Test Consumables Spectrometer A", "_Test Consumables Spectrometer")
		parent = new_observation(reagent_template("Stock Mixed Panel"), service_unit=analyser)

		component = new_observation(
			reagent_template("Stock Mixed Leaf", unit_type="_Test Consumables Spectrometer"),
			parent_observation=parent.name,
		)

		self.assertEqual(component.service_unit, spectrometer)

	def test_a_correction_of_a_result_without_consumables_issues_none(self):
		template = reagent_template("Stock Unconfigured")
		original = new_observation(template, warehouse=WAREHOUSE)
		# As if the template's supplies were set up after this result was made.
		original.set("consumables", [])
		original.save()
		set_observation_status(original.name, "Approved")
		before = stock_qty(REAGENT)

		set_observation_status(original.name, "Rejected", reason="Wrong unit typed")
		replacement = replacement_of(template)
		set_observation_status(replacement.name, "Approved")

		self.assertEqual(replacement.consumables, [])
		self.assertEqual(stock_qty(REAGENT), before)


def reagent_template(name, unit_type=None):
	template = create_lab_sample_leaf(name, None)
	template.consume_stock = 1
	template.service_unit = unit_type
	template.set(
		"consumables",
		[
			{"item_code": TUBE, "consumed_at": "Specimen", "qty": 1},
			{"item_code": REAGENT, "consumed_at": "Observation", "qty": 2},
		],
	)
	template.save()
	return template


def new_observation(template, **fields):
	observation = frappe.get_doc(
		{
			"doctype": "Observation",
			"observation_template": template.name,
			"patient": "_Test Patient",
			"company": "_Test Company",
			"result": "5",
			**fields,
		}
	)
	observation.insert(ignore_permissions=True)
	return observation


def replacement_of(template):
	"""The editable copy a rejection leaves behind."""
	return frappe.get_doc("Observation", {"observation_template": template.name, "docstatus": 0})


def service_request_for(template, unit_type):
	request = frappe.get_doc(
		{
			"doctype": "Service Request",
			"patient": "_Test Patient",
			"company": "_Test Company",
			"practitioner": frappe.db.get_value("Healthcare Practitioner", {"first_name": "_Test"}),
			"order_date": nowdate(),
			"order_time": nowtime(),
			"status": "active-Request Status",
			"template_dt": "Observation Template",
			"template_dn": template.name,
			"healthcare_service_unit_type": unit_type,
		}
	)
	request.insert(ignore_permissions=True)
	return request.name


def make_unit_type(name):
	if not frappe.db.exists("Healthcare Service Unit Type", name):
		frappe.get_doc(
			{"doctype": "Healthcare Service Unit Type", "service_unit_type": name, "allow_appointments": 1}
		).insert()


def make_unit(name, unit_type, warehouse=WAREHOUSE):
	unit = frappe.get_doc(
		{
			"doctype": "Healthcare Service Unit",
			"healthcare_service_unit_name": name,
			"service_unit_type": unit_type,
			"company": "_Test Company",
			"warehouse": warehouse,
		}
	)
	# Other apps on the test site may add mandatory custom fields to units.
	unit.insert(ignore_permissions=True, ignore_mandatory=True)
	return unit.name
