# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import json

import frappe
from frappe import _
from frappe.contacts.address_and_contact import load_address_and_contact
from frappe.utils import cint, cstr
from frappe.utils.nestedset import NestedSet

# Group warehouse under which one warehouse per inpatient bed is created.
BED_WAREHOUSE_GROUP = "Inpatient Beds"


class HealthcareServiceUnit(NestedSet):
	nsm_parent_field = "parent_healthcare_service_unit"

	def onload(self):
		"""Load address and contacts in `__onload`"""
		load_address_and_contact(self)

	def validate(self):
		self.set_service_unit_properties()
		self.set_bed_warehouse()

	def autoname(self):
		if self.company:
			suffix = " - " + frappe.get_cached_value("Company", self.company, "abbr")
			if not self.healthcare_service_unit_name.endswith(suffix):
				self.name = self.healthcare_service_unit_name + suffix
		else:
			self.name = self.healthcare_service_unit_name

	def on_update(self):
		super().on_update()
		self.validate_one_root()

	def on_trash(self):
		if self.flags.on_trash_company:
			NestedSet.on_trash(self, allow_root_deletion=True)
		else:
			NestedSet.on_trash(self)

	def set_service_unit_properties(self):
		if cint(self.is_group):
			self.allow_appointments = False
			self.overlap_appointments = False
			self.inpatient_occupancy = False
			self.service_unit_capacity = 0
			self.occupancy_status = ""
			self.service_unit_type = ""
		elif self.service_unit_type != "":
			service_unit_type = frappe.get_doc("Healthcare Service Unit Type", self.service_unit_type)
			self.allow_appointments = service_unit_type.allow_appointments
			self.inpatient_occupancy = service_unit_type.inpatient_occupancy

			if self.inpatient_occupancy and self.occupancy_status != "":
				self.occupancy_status = "Vacant"

			if service_unit_type.overlap_appointments:
				self.overlap_appointments = True
			else:
				self.overlap_appointments = False
				self.service_unit_capacity = 0

		if self.overlap_appointments:
			if not self.service_unit_capacity:
				frappe.throw(
					_("Please set a valid Service Unit Capacity to enable Overlapping Appointments"),
					title=_("Mandatory"),
				)

	def set_bed_warehouse(self):
		"""Medication is transferred to the warehouse of the bed it was prescribed
		for, so a bed needs a warehouse of its own. One picked while creating beds
		in bulk would be shared by all of them, leaving no way to tell one bed's
		stock from another's, so it is replaced rather than kept."""
		if cint(self.is_group) or not cint(self.inpatient_occupancy):
			return

		if not self.company or not manages_medication_stock():
			return

		if self.warehouse and not self.is_new():
			return

		self.warehouse = create_bed_warehouse(self)


def manages_medication_stock():
	return frappe.db.get_single_value("Healthcare Settings", "manage_inpatient_medication_stock")


def create_bed_warehouses():
	"""Give every occupancy unit that has no warehouse one. Returns how many."""
	beds = frappe.get_all(
		"Healthcare Service Unit",
		filters={"is_group": 0, "inpatient_occupancy": 1, "warehouse": ["in", ["", None]]},
		fields=["name", "healthcare_service_unit_name", "company"],
	)

	for bed in beds:
		if not bed.company:
			continue

		frappe.db.set_value(
			"Healthcare Service Unit", bed.name, "warehouse", create_bed_warehouse(bed), update_modified=False
		)

	return len(beds)


def create_bed_warehouse(service_unit):
	"""Warehouse named after the bed, kept together under a per company group."""
	name = warehouse_name_for(service_unit.healthcare_service_unit_name, service_unit.company)
	if frappe.db.exists("Warehouse", name):
		return name

	warehouse = frappe.new_doc("Warehouse")
	warehouse.warehouse_name = service_unit.healthcare_service_unit_name
	warehouse.company = service_unit.company
	warehouse.parent_warehouse = get_bed_warehouse_group(service_unit.company)
	warehouse.insert(ignore_permissions=True)
	return warehouse.name


def get_bed_warehouse_group(company):
	name = warehouse_name_for(BED_WAREHOUSE_GROUP, company)
	if frappe.db.exists("Warehouse", name):
		return name

	group = frappe.new_doc("Warehouse")
	group.warehouse_name = BED_WAREHOUSE_GROUP
	group.company = company
	group.is_group = 1
	group.parent_warehouse = get_root_warehouse(company)
	group.insert(ignore_permissions=True)
	return group.name


def get_root_warehouse(company):
	return frappe.db.get_value(
		"Warehouse", {"company": company, "is_group": 1, "parent_warehouse": ["in", ["", None]]}
	)


def warehouse_name_for(warehouse_name, company):
	abbr = frappe.get_cached_value("Company", company, "abbr")
	return f"{warehouse_name} - {abbr}"


@frappe.whitelist()
def add_multiple_service_units(parent, data):
	"""
	parent - parent service unit under which the service units are to be created
	data (dict) - company, healthcare_service_unit_name, count, service_unit_type, warehouse, service_unit_capacity
	"""
	if not parent or not data:
		return

	data = json.loads(data)
	company = (
		data.get("company")
		or frappe.defaults.get_defaults().get("company")
		or frappe.db.get_single_value("Global Defaults", "default_company")
	)

	if not data.get("healthcare_service_unit_name") or not company:
		frappe.throw(
			_("Service Unit Name and Company are mandatory to create Healthcare Service Units"),
			title=_("Missing Required Fields"),
		)

	count = cint(data.get("count") or 0)
	if count <= 0:
		frappe.throw(
			_("Number of Service Units to be created should at least be 1"),
			title=_("Invalid Number of Service Units"),
		)

	capacity = cint(data.get("service_unit_capacity") or 1)

	service_unit = {
		"doctype": "Healthcare Service Unit",
		"parent_healthcare_service_unit": parent if parent != company else None,
		"service_unit_type": data.get("service_unit_type") or None,
		"service_unit_capacity": capacity if capacity > 0 else 1,
		"warehouse": data.get("warehouse") or None,
		"company": company,
	}

	service_unit_name = "{}".format(data.get("healthcare_service_unit_name").strip(" -"))

	last_suffix = frappe.db.sql(
		"""SELECT
		IFNULL(MAX(CAST(SUBSTRING(name FROM %(start)s FOR 4) AS UNSIGNED)), 0)
		FROM `tabHealthcare Service Unit`
		WHERE name like %(prefix)s AND company=%(company)s""",
		{
			"start": len(service_unit_name) + 2,
			"prefix": f"{service_unit_name}-%",
			"company": company,
		},
		as_list=1,
	)[0][0]
	start_suffix = cint(last_suffix) + 1

	failed_list = []
	for i in range(start_suffix, count + start_suffix):
		# name to be in the form WARD-####
		service_unit["healthcare_service_unit_name"] = f"{service_unit_name}-{cstr(f'{i:04d}')}"
		service_unit_doc = frappe.get_doc(service_unit)
		try:
			service_unit_doc.insert()
		except Exception:
			failed_list.append(service_unit["healthcare_service_unit_name"])

	return failed_list


def on_doctype_update():
	frappe.db.add_unique(
		"Healthcare Service Unit",
		["healthcare_service_unit_name", "company"],
		constraint_name="unique_service_unit_company",
	)
