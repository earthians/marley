# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.utils import flt

from healthcare.healthcare.doctype.sample_collection.collection_consumables import (
	issue_collect_action,
	issue_collection_consumables,
	record_consumables,
)
from healthcare.healthcare.doctype.sample_collection.sample_collection import (
	insert_observation,
	preview_collect,
)
from healthcare.healthcare.doctype.sample_collection.test_sample_collection import create_lab_sample_leaf
from healthcare.tests.utils import HealthcareTestSuite

BLOOD = "_Test Sample - Blood Sample"
URINE = "_Test Sample - Urine"
WAREHOUSE = "Stores - _TC"
TUBE, NEEDLE, LABEL = "_Test Consumable Tube", "_Test Consumable Needle", "_Test Consumable Label"


class TestCollectionConsumables(HealthcareTestSuite):
	def setUp(self):
		for item in (TUBE, NEEDLE, LABEL):
			make_stock_item(item)
			receive(item, 5)

	def test_tests_sharing_a_tube_and_a_draw_record_each_item_once(self):
		first = consuming_template("Consumables Glucose", BLOOD, labels=2)
		second = consuming_template("Consumables Urea", BLOOD, labels=1)
		doc = collection_for(first, second)

		collect(doc, doc.observation_sample_collection)

		self.assertEqual(recorded(doc), {(TUBE, BLOOD): 1, (LABEL, BLOOD): 2, (NEEDLE, None): 1})

	def test_the_calls_of_one_collect_action_share_containers(self):
		first = consuming_template("Consumables Creatinine", BLOOD)
		second = consuming_template("Consumables Uric Acid", BLOOD)
		doc = collection_for(first, second)

		for row in doc.observation_sample_collection:
			collect(doc, [row], collect_action="one press")

		self.assertEqual(recorded(doc), {(TUBE, BLOOD): 1, (LABEL, BLOOD): 1, (NEEDLE, None): 1})

	def test_a_later_collect_of_a_counted_container_offers_a_new_one(self):
		doc = collection_for(
			consuming_template("Consumables Free Ammonia", BLOOD, labels=1),
			consuming_template("Consumables Serum Aldolase", BLOOD, labels=3),
		)
		collect(doc, doc.observation_sample_collection[:1], collect_action="first")

		collect(doc, doc.observation_sample_collection[1:], collect_action="second")

		# Same tube: only the two extra labels. New tube: all of it.
		self.assertEqual(offered(doc, "second"), {TUBE: (0, 1), LABEL: (2, 3), NEEDLE: (0, 1)})

	def test_confirming_a_new_container_issues_all_of_it(self):
		doc = self.collected_twice("Consumables Lipoprotein A", "Consumables Leptin Level")
		before = stock_qty(TUBE)

		issue_collection_consumables(doc.name, reviewed_as(doc, "second", new_container=True))

		self.assertEqual(stock_qty(TUBE), before - 1)

	def test_declining_a_new_container_removes_its_rows(self):
		doc = self.collected_twice("Consumables Total Prealbumin", "Consumables Serum Procalcitonin")
		before = stock_qty(TUBE)

		issue_collection_consumables(doc.name, reviewed_as(doc, "second", new_container=False))

		self.assertEqual(stock_qty(TUBE), before)
		self.assertEqual(offered(doc, "second"), {})

	def test_the_review_before_a_collect_shows_what_it_records_and_writes_nothing(self):
		doc = collection_for(consuming_template("Consumables Bicarbonate", BLOOD, labels=2))
		rows = doc.observation_sample_collection

		preview = preview_of(doc, rows, "press")

		self.assertEqual(recorded(doc), {})
		collect(doc, rows, collect_action="press")
		self.assertEqual(
			{row["item_code"]: (row["qty"], row["suggested_qty"]) for row in preview}, offered(doc, "press")
		)

	def test_the_review_matches_the_collect_when_given_its_order(self):
		# The tree collects in groups and previews in that same order, so units agree.
		add_uom_conversion(TUBE, "_Test Pair", 2)
		single = consuming_template("Consumables Unit Order Single", BLOOD)
		paired = consuming_template("Consumables Unit Order Paired", BLOOD)
		paired.consumables[0].uom = "_Test Pair"
		paired.save()
		doc = collection_for(single, paired)
		first, second = doc.observation_sample_collection

		preview = preview_of(doc, [first, second], "press")
		collect(doc, [first], collect_action="press")
		collect(doc, [second], collect_action="press")

		tube = next(row for row in doc.reload().consumables if row.item_code == TUBE)
		shown = next(row for row in preview if row["item_code"] == TUBE)
		self.assertEqual((shown["qty"], shown["uom"]), (tube.qty, tube.uom))

	def test_a_collect_reviewed_beforehand_issues_the_reviewed_quantities(self):
		doc = collection_for(consuming_template("Consumables Phenytoin", BLOOD, labels=2))
		rows = doc.observation_sample_collection
		review = [
			{**row, "shown_qty": row["qty"], "qty": 0 if row["item_code"] == LABEL else row["qty"]}
			for row in preview_of(doc, rows, "press")
		]
		before = {item: stock_qty(item) for item in (TUBE, LABEL)}

		collect(doc, rows, collect_action="press")
		issue_collect_action(doc.name, "press", review)

		self.assertEqual(stock_qty(TUBE), before[TUBE] - 1)
		self.assertEqual(stock_qty(LABEL), before[LABEL])

	def test_the_review_before_a_later_collect_offers_a_new_container(self):
		doc = self.collected_twice_first_only("Consumables Digoxin", "Consumables Vancomycin")

		preview = preview_of(doc, doc.observation_sample_collection[1:], "second")

		self.assertEqual(
			{row["item_code"]: (row["qty"], row["suggested_qty"]) for row in preview},
			{TUBE: (0, 1), LABEL: (0, 1), NEEDLE: (0, 1)},
		)

	def collected_twice_first_only(self, first, second):
		doc = collection_for(consuming_template(first, BLOOD), consuming_template(second, BLOOD))
		collect(doc, doc.observation_sample_collection[:1], collect_action="first")
		issue_reviewed(doc)
		return doc

	def collected_twice(self, first, second):
		doc = collection_for(consuming_template(first, BLOOD), consuming_template(second, BLOOD))
		collect(doc, doc.observation_sample_collection[:1], collect_action="first")
		issue_reviewed(doc)
		collect(doc, doc.observation_sample_collection[1:], collect_action="second")
		return doc

	def test_each_container_type_records_its_own_items(self):
		blood = consuming_template("Consumables Sodium", BLOOD)
		urine = consuming_template("Consumables Urine Protein", URINE)
		doc = collection_for(blood, urine)

		collect(doc, doc.observation_sample_collection)

		self.assertEqual(recorded(doc)[(TUBE, URINE)], 1)
		self.assertEqual(recorded(doc)[(TUBE, BLOOD)], 1)
		self.assertEqual(recorded(doc)[(NEEDLE, None)], 1)

	def test_each_department_gets_its_own_container_but_shares_the_draw(self):
		haematology = consuming_template("Consumables HbA1c", BLOOD, department="_Test Medical Department 0")
		biochemistry = consuming_template(
			"Consumables Lipids", BLOOD, department="_Test Medical Department 1"
		)
		doc = collection_for(haematology, biochemistry)

		collect(doc, doc.observation_sample_collection)

		self.assertEqual(recorded_totals(doc), {TUBE: 2, LABEL: 2, NEEDLE: 1})

	def test_each_closure_color_gets_its_own_container(self):
		# Only panel components carry their template's color; a top-level row takes its sample's.
		lavender = consuming_template("Consumables Lavender Test", BLOOD, color="_Test Lavender")
		gold = consuming_template("Consumables Gold Test", BLOOD, color="_Test Gold")
		doc = collection_for()

		record_consumables(doc.name, [component_entry(lavender), component_entry(gold)])

		self.assertEqual(recorded_totals(doc), {TUBE: 2, LABEL: 2, NEEDLE: 1})

	def test_one_template_in_two_containers_records_both(self):
		# Collected as a standalone test and as a panel's component, in different colors.
		template = consuming_template("Consumables Twice Collected", BLOOD)
		as_test = {**component_entry(template), "container_closure_color": make_color("_Test Lavender")}
		as_component = {**component_entry(template), "container_closure_color": make_color("_Test Gold")}
		doc = collection_for()

		record_consumables(doc.name, [as_test, as_component])

		self.assertEqual(recorded_totals(doc), {TUBE: 2, LABEL: 2, NEEDLE: 1})

	def test_templates_listing_an_item_in_different_uoms_share_it_in_stock_units(self):
		add_uom_conversion(TUBE, "_Test Pair", 2)
		single = consuming_template("Consumables Single Tube", BLOOD)
		paired = consuming_template("Consumables Paired Tube", BLOOD)
		paired.consumables[0].uom = "_Test Pair"
		paired.save()
		doc = collection_for(single, paired)

		collect(doc, doc.observation_sample_collection)

		# One tube for the first test, raised to a pair (2 Nos) for the second: not 3.
		tube_rows = [row for row in doc.reload().consumables if row.item_code == TUBE]
		self.assertEqual(sum(row.stock_qty for row in tube_rows), 2)

	def test_the_review_says_which_container_each_row_is_for(self):
		lavender = consuming_template("Consumables Review Lavender", BLOOD, color="_Test Lavender")
		gold = consuming_template("Consumables Review Gold", BLOOD, color="_Test Gold")
		doc = collection_for(lavender, gold)
		# A standalone row carries its own closure color.
		for row, template in zip(doc.observation_sample_collection, (lavender, gold), strict=True):
			row.container_closure_color = template.container_closure_color

		preview = preview_of(doc, doc.observation_sample_collection, "press")

		tubes = {row["container_closure_color"] for row in preview if row["item_code"] == TUBE}
		self.assertEqual(tubes, {"_Test Lavender", "_Test Gold"})

	def test_template_not_consuming_stock_records_nothing(self):
		template = consuming_template("Consumables Switched Off", BLOOD)
		frappe.db.set_value("Observation Template", template.name, "consume_stock", 0)
		doc = collection_for(template)

		collect(doc, doc.observation_sample_collection)

		self.assertEqual(recorded(doc), {})

	def test_specimen_links_back_to_its_collection(self):
		doc = collection_for(consuming_template("Consumables Potassium", BLOOD))

		collect(doc, doc.observation_sample_collection)

		self.assertTrue(frappe.db.exists("Specimen", {"sample_collection": doc.name}))

	def test_collecting_issues_the_recorded_items(self):
		doc = collection_for(consuming_template("Consumables Chloride", BLOOD))
		collect(doc, doc.observation_sample_collection)
		before = stock_qty(TUBE)

		issue_reviewed(doc)

		self.assertEqual(stock_qty(TUBE), before - 1)
		self.assertTrue(all(row.stock_entry for row in doc.reload().consumables))

	def test_a_later_collect_issues_only_what_it_adds(self):
		doc = collection_for(
			consuming_template("Consumables Sodium", BLOOD), consuming_template("Consumables pH", URINE)
		)
		collect(doc, doc.observation_sample_collection[:1])
		issue_reviewed(doc)
		before = {item: stock_qty(item) for item in (TUBE, NEEDLE)}

		collect(doc, doc.observation_sample_collection[1:])
		issue_reviewed(doc)

		# The urine container needs a tube; the draw was already issued.
		self.assertEqual(stock_qty(TUBE), before[TUBE] - 1)
		self.assertEqual(stock_qty(NEEDLE), before[NEEDLE])

	def test_more_of_an_issued_item_goes_on_a_row_of_its_own(self):
		doc = collection_for(
			consuming_template("Consumables Albumin", BLOOD, labels=1),
			consuming_template("Consumables Globulin", BLOOD, labels=3),
		)
		collect(doc, doc.observation_sample_collection[:1])
		issue_reviewed(doc)
		before = stock_qty(LABEL)

		collect(doc, doc.observation_sample_collection[1:])

		# The issued row keeps its batch; the extra can take another.
		labels = [(row.qty, bool(row.stock_entry)) for row in label_rows(doc)]
		self.assertEqual(sorted(labels), [(1, True), (2, False)])
		issue_reviewed(doc)
		self.assertEqual(stock_qty(LABEL), before - 2)

	def test_an_issued_row_cannot_be_reduced(self):
		doc = collection_for(consuming_template("Consumables Lipase", BLOOD, labels=2))
		collect(doc, doc.observation_sample_collection)
		issue_reviewed(doc)
		label = label_rows(doc)[0]

		with self.assertRaises(frappe.ValidationError):
			issue_collection_consumables(doc.name, [{"row_name": label.name, "qty": 1}])

	def test_skipping_the_extra_quantity_issues_none_of_it(self):
		doc = collection_for(
			consuming_template("Consumables Bilirubin", BLOOD, labels=1),
			consuming_template("Consumables Urobilinogen", BLOOD, labels=3),
		)
		collect(doc, doc.observation_sample_collection[:1])
		issue_reviewed(doc)
		collect(doc, doc.observation_sample_collection[1:])
		extra = next(row for row in label_rows(doc) if not row.stock_entry)
		before = stock_qty(LABEL)

		issue_collection_consumables(doc.name, [{"row_name": extra.name, "qty": 0}])

		self.assertEqual(stock_qty(LABEL), before)

	def test_issue_fields_sent_by_a_client_are_ignored(self):
		doc = collection_for(consuming_template("Consumables Lactate", BLOOD))
		collect(doc, doc.observation_sample_collection)
		issue_reviewed(doc)
		before = stock_qty(TUBE)

		doc.reload()
		for row in doc.consumables:
			row.stock_entry, row.issued_qty = None, 0
		doc.save()
		issue_reviewed(doc)

		self.assertEqual(stock_qty(TUBE), before)

	def test_supplies_added_while_the_review_was_open_wait_for_their_own(self):
		doc = collection_for(
			consuming_template("Consumables Cortisol", BLOOD),
			consuming_template("Consumables Urine Bilirubin", URINE),
		)
		collect(doc, doc.observation_sample_collection[:1])
		reviewed = pending_rows(doc)
		collect(doc, doc.observation_sample_collection[1:])
		before = stock_qty(TUBE)

		issue_collection_consumables(doc.name, reviewed)

		# The blood tube went out; the urine tube collected meanwhile did not.
		self.assertEqual(stock_qty(TUBE), before - 1)
		pending = [row.item_code for row in doc.reload().consumables if not row.stock_entry]
		self.assertEqual(sorted(pending), sorted([TUBE, LABEL]))

	def test_a_row_raised_while_the_review_was_open_must_be_reviewed_again(self):
		doc = collection_for(
			consuming_template("Consumables Haptoglobin", BLOOD, labels=1),
			consuming_template("Consumables Transferrin", BLOOD, labels=3),
		)
		collect(doc, doc.observation_sample_collection[:1])
		label = label_rows(doc)[0]
		collect(doc, doc.observation_sample_collection[1:])

		with self.assertRaises(frappe.ValidationError):
			issue_collection_consumables(doc.name, [{"row_name": label.name, "qty": 1, "shown_qty": 1}])
		self.assertEqual(frappe.db.get_value("Observation Consumable", label.name, "qty"), 3)

	def test_confirming_the_same_review_twice_issues_once(self):
		doc = collection_for(consuming_template("Consumables Osmolality", BLOOD))
		collect(doc, doc.observation_sample_collection)
		review = pending_rows(doc)
		before = stock_qty(TUBE)

		issue_collection_consumables(doc.name, review)
		issue_collection_consumables(doc.name, review)

		self.assertEqual(stock_qty(TUBE), before - 1)

	def test_an_issued_row_cannot_be_removed(self):
		doc = collection_for(consuming_template("Consumables Troponin", BLOOD))
		collect(doc, doc.observation_sample_collection)
		issue_reviewed(doc)

		doc.reload()
		doc.consumables = [row for row in doc.consumables if row.item_code != TUBE]
		with self.assertRaises(frappe.ValidationError):
			doc.save()

	def test_submit_issues_what_a_skipped_review_left(self):
		doc = collection_for(consuming_template("Consumables Amylase", BLOOD))
		collect(doc, doc.observation_sample_collection)
		before = stock_qty(TUBE)

		doc.reload()
		doc.submit()

		self.assertEqual(stock_qty(TUBE), before - 1)

	def test_submit_without_consume_stock_issues_nothing(self):
		doc = collection_for(consuming_template("Consumables Calcium", BLOOD))
		collect(doc, doc.observation_sample_collection)

		doc.reload()
		doc.consume_stock = 0
		doc.submit()

		self.assertFalse(any(row.stock_entry for row in doc.reload().consumables))

	def test_submit_needs_every_sample_collected(self):
		first = consuming_template("Consumables Phosphorus", BLOOD)
		second = consuming_template("Consumables Iron", BLOOD)
		doc = collection_for(first, second)
		collect(doc, doc.observation_sample_collection[:1])

		doc.reload()
		with self.assertRaises(frappe.ValidationError):
			doc.submit()

	def test_submitted_collection_takes_no_more_samples(self):
		doc = collection_for(consuming_template("Consumables Ferritin", BLOOD))
		rows = doc.observation_sample_collection
		collect(doc, rows)
		doc.reload()
		doc.submit()

		with self.assertRaises(frappe.ValidationError):
			collect(doc, rows)

	def test_a_result_is_approved_while_another_sample_is_still_open(self):
		doc = collection_for(
			consuming_template("Consumables Zinc", BLOOD), consuming_template("Consumables Ketones", URINE)
		)
		collect(doc, doc.observation_sample_collection[:1])
		observation = frappe.get_doc("Observation", {"reference_docname": doc.name})
		observation.result = "5"

		observation.submit()

		self.assertEqual(observation.docstatus, 1)

	def test_warehouse_falls_back_to_company_default(self):
		frappe.db.set_value("Company", "_Test Company", "default_warehouse", WAREHOUSE)
		doc = collection_for(consuming_template("Consumables Magnesium", BLOOD), warehouse=None)

		self.assertEqual(doc.warehouse, WAREHOUSE)


def consuming_template(name, sample, labels=1, department=None, color=None):
	template = create_lab_sample_leaf(name, sample)
	template.consume_stock = 1
	template.medical_department = department
	template.container_closure_color = color and make_color(color)
	template.set(
		"consumables",
		[
			{"item_code": TUBE, "consumed_at": "Specimen", "qty": 1},
			{"item_code": LABEL, "consumed_at": "Specimen", "qty": labels},
			{"item_code": NEEDLE, "consumed_at": "Sample Collection", "qty": 1},
		],
	)
	template.save()
	return template


def collection_for(*templates, warehouse=WAREHOUSE):
	doc = frappe.get_doc(
		{"doctype": "Sample Collection", "patient": "_Test Patient", "company": "_Test Company"}
	)
	doc.warehouse = warehouse
	for template in templates:
		doc.append(
			"observation_sample_collection",
			{
				"observation_template": template.name,
				"sample": template.sample,
				"medical_department": template.medical_department,
				"status": "Open",
			},
		)
	doc.insert(ignore_permissions=True)
	return doc


def collect(doc, rows, collect_action=None):
	selected = [row.as_dict() for row in rows]
	insert_observation(
		selected=json.dumps(selected, default=str),
		sample_collection=doc.name,
		collect_action=collect_action,
	)


def preview_of(doc, rows, collect_action):
	selected = json.dumps([row.as_dict() for row in rows], default=str)
	return preview_collect(doc.name, selected, collect_action)


def offered(doc, collect_action):
	"""Item to (same-container quantity, new-container quantity) for one action's rows."""
	rows = [row for row in doc.reload().consumables if row.collect_action == collect_action]
	return {row.item_code: (flt(row.qty), flt(row.suggested_qty)) for row in rows}


def reviewed_as(doc, collect_action, new_container):
	"""One action's rows as the review sends them, with New Container ticked or not."""
	rows = [row for row in doc.reload().consumables if row.collect_action == collect_action]
	return [
		{
			"row_name": row.name,
			"qty": row.suggested_qty if new_container else 0,
			"shown_qty": row.qty,
		}
		for row in rows
	]


def issue_reviewed(doc):
	"""As the review does when staff confirm it unchanged."""
	issue_collection_consumables(doc.name, pending_rows(doc))


def pending_rows(doc):
	rows = [row for row in doc.reload().consumables if not row.stock_entry]
	return [{"row_name": row.name, "qty": row.qty, "batch_no": row.batch_no} for row in rows]


def label_rows(doc):
	return [row for row in doc.reload().consumables if row.item_code == LABEL]


def recorded(doc):
	rows = frappe.get_all(
		"Observation Consumable",
		filters={"parent": doc.name, "parenttype": "Sample Collection"},
		fields=["item_code", "sample", "qty"],
	)
	return {(row.item_code, row.sample): flt(row.qty) for row in rows}


def component_entry(template):
	"""A panel component as set_component_observation_data() describes it."""
	return {
		"observation_template": template.name,
		"sample": template.sample,
		"medical_department": template.medical_department,
		"container_closure_color": template.container_closure_color,
	}


def recorded_totals(doc):
	totals = {}
	for row in frappe.get_all(
		"Observation Consumable",
		filters={"parent": doc.name, "parenttype": "Sample Collection"},
		fields=["item_code", "qty"],
	):
		totals[row.item_code] = totals.get(row.item_code, 0) + flt(row.qty)
	return totals


def make_color(name):
	if not frappe.db.exists("Color", name):
		color = frappe.get_doc({"doctype": "Color", "color": "#7F00FF"})
		color.insert(set_name=name)
	return name


def make_stock_item(item_code, stock_uom="Nos"):
	if frappe.db.exists("Item", item_code):
		return
	frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": item_code,
			"item_group": "Products",
			"stock_uom": stock_uom,
			"is_stock_item": 1,
			"valuation_rate": 10,
		}
	).insert(ignore_permissions=True)


def make_uom(name):
	"""A unit that allows fractions, as ml or grams do."""
	if not frappe.db.exists("UOM", name):
		frappe.get_doc({"doctype": "UOM", "uom_name": name, "must_be_whole_number": 0}).insert()
	return name


def add_uom_conversion(item_code, uom, factor):
	item = frappe.get_doc("Item", item_code)
	if not any(row.uom == uom for row in item.uoms):
		item.append("uoms", {"uom": make_uom(uom), "conversion_factor": factor})
		item.save()


def receive(item_code, qty):
	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry.stock_entry_type = "Material Receipt"
	stock_entry.company = "_Test Company"
	stock_entry.append(
		"items", {"item_code": item_code, "qty": qty, "t_warehouse": WAREHOUSE, "basic_rate": 10}
	)
	stock_entry.submit()


def stock_qty(item_code):
	return flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": WAREHOUSE}, "actual_qty"))
