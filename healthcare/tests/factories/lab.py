import frappe
from frappe.utils import flt, nowdate, nowtime

BLOOD = "_Test Sample - Blood Sample"
URINE = "_Test Sample - Urine"
WAREHOUSE = "Stores - _TC"
TUBE, NEEDLE, LABEL = "_Test Consumable Tube", "_Test Consumable Needle", "_Test Consumable Label"
REAGENT = "_Test Consumable Reagent"
ANALYSER = "_Test Consumables Analyser"


def create_observation_template(obs_name, idx="", sample_required=None):
	if frappe.db.exists("Observation Template", obs_name + str(idx)):
		return frappe.get_doc("Observation Template", obs_name + str(idx))
	template = frappe.new_doc("Observation Template")
	template.observation = obs_name + str(idx)
	template.item_code = obs_name + str(idx)
	template.observation_category = "Laboratory"
	template.permitted_data_type = "Quantity"
	template.permitted_unit = "mg / dl"
	template.item_group = "Services"
	template.sample_collection_required = sample_required
	template.rate = 300
	template.abbr = "TC" + str(idx)
	template.is_billable = 1
	template.save()
	return template


def create_multi_level_template():
	"""A 3-level nesting: a top-level package containing a sub-panel, which
	itself contains the one sample-required leaf. Shared by the recursive
	sample-collection tests (set_component_observation_data,
	mark_component_collected, ...)."""
	leaf = create_observation_template("_Test Nested Leaf", sample_required=True)

	if frappe.db.exists("Observation Template", "_Test Nested Sub Panel"):
		sub_panel = frappe.get_doc("Observation Template", "_Test Nested Sub Panel")
	else:
		sub_panel = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Nested Sub Panel",
				"item_code": "_Test Nested Sub Panel",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TNSP",
				"is_billable": 1,
				"observation_component": [{"observation_template": leaf.name}],
			}
		)
		sub_panel.insert()

	if frappe.db.exists("Observation Template", "_Test Top Package"):
		package = frappe.get_doc("Observation Template", "_Test Top Package")
	else:
		package = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Top Package",
				"item_code": "_Test Top Package",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TTP",
				"is_billable": 1,
				"observation_component": [{"observation_template": sub_panel.name}],
			}
		)
		package.insert()

	return package, sub_panel, leaf


def create_mixed_sub_panel_template():
	"""A package containing a sub-panel with both a sample-required leaf
	and a non-sample-required one directly on it."""
	sample_leaf = create_observation_template("_Test Mixed Sample Leaf", idx=1, sample_required=True)
	non_sample_leaf = create_observation_template("_Test Mixed Non Sample Leaf", idx=2, sample_required=False)

	if frappe.db.exists("Observation Template", "_Test Mixed Sub Panel"):
		sub_panel = frappe.get_doc("Observation Template", "_Test Mixed Sub Panel")
	else:
		sub_panel = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Mixed Sub Panel",
				"item_code": "_Test Mixed Sub Panel",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TMSP",
				"is_billable": 1,
				"observation_component": [
					{"observation_template": sample_leaf.name},
					{"observation_template": non_sample_leaf.name},
				],
			}
		)
		sub_panel.insert()

	if frappe.db.exists("Observation Template", "_Test Mixed Package"):
		package = frappe.get_doc("Observation Template", "_Test Mixed Package")
	else:
		package = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Mixed Package",
				"item_code": "_Test Mixed Package",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TMPKG",
				"is_billable": 1,
				"observation_component": [{"observation_template": sub_panel.name}],
			}
		)
		package.insert()

	return package, sub_panel, sample_leaf, non_sample_leaf


def create_pure_non_sample_sub_panel_template():
	"""A package with a sample-required leaf, plus a sub-panel whose own
	children are all non-sample-required."""
	sample_leaf = create_observation_template("_Test Package Own Sample Leaf", idx=3, sample_required=True)
	non_sample_leaf = create_observation_template("_Test Pure Non Sample Leaf", idx=4, sample_required=False)

	if frappe.db.exists("Observation Template", "_Test Pure Non Sample Sub Panel"):
		sub_panel = frappe.get_doc("Observation Template", "_Test Pure Non Sample Sub Panel")
	else:
		sub_panel = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Pure Non Sample Sub Panel",
				"item_code": "_Test Pure Non Sample Sub Panel",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TPNSP",
				"is_billable": 1,
				"observation_component": [{"observation_template": non_sample_leaf.name}],
			}
		)
		sub_panel.insert()

	if frappe.db.exists("Observation Template", "_Test Pure Non Sample Package"):
		package = frappe.get_doc("Observation Template", "_Test Pure Non Sample Package")
	else:
		package = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Pure Non Sample Package",
				"item_code": "_Test Pure Non Sample Package",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TPNPKG",
				"is_billable": 1,
				"observation_component": [
					{"observation_template": sample_leaf.name},
					{"observation_template": sub_panel.name},
				],
			}
		)
		package.insert()

	return package, sub_panel, sample_leaf, non_sample_leaf


def create_lab_sample_leaf(name, sample):
	if frappe.db.exists("Observation Template", name):
		return frappe.get_doc("Observation Template", name)
	template = frappe.new_doc("Observation Template")
	template.observation = name
	template.item_code = name
	template.observation_category = "Laboratory"
	template.permitted_data_type = "Quantity"
	template.permitted_unit = "mg / dl"
	template.item_group = "Services"
	template.sample_collection_required = 1
	template.sample = sample
	template.rate = 300
	template.abbr = "".join(w[0] for w in name.split())
	template.is_billable = 1
	template.save()
	return template


def consuming_template(name, sample, labels=1, department=None, color=None):
	template = create_lab_sample_leaf(name, sample)
	template.consume_stock = 1
	template.medical_department = department
	template.container_closure_color = color
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


def add_uom_conversion(item_code, uom, factor):
	item = frappe.get_doc("Item", item_code)
	if not any(row.uom == uom for row in item.uoms):
		item.append("uoms", {"uom": uom, "conversion_factor": factor})
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


def service_request_for(template, unit_type):
	request = frappe.get_doc(
		{
			"doctype": "Service Request",
			"patient": "_Test Patient",
			"company": "_Test Company",
			"practitioner": "_Test Healthcare Practitioner 2",
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
