# -*- coding: utf-8 -*-
# Copyright (c) 2015, ESS LLP and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.contacts.address_and_contact import (
	delete_contact_and_address,
	load_address_and_contact,
)
from frappe.model.document import Document
from frappe.model.naming import append_number_if_name_exists
from frappe.utils import get_link_to_form

from erpnext.accounts.party import validate_party_accounts


class HealthcarePractitioner(Document):
	def onload(self):
		load_address_and_contact(self)

	def autoname(self):
		# concat first and last name
		self.name = self.practitioner_name

		if frappe.db.exists("Healthcare Practitioner", self.name):
			self.name = append_number_if_name_exists("Contact", self.name)

	def validate(self):
		self.set_full_name()
		validate_party_accounts(self)
		if self.inpatient_visit_charge_item:
			validate_service_item(
				self.inpatient_visit_charge_item,
				"Configure a service Item for Inpatient Consulting Charge Item",
			)
		if self.op_consulting_charge_item:
			validate_service_item(
				self.op_consulting_charge_item,
				"Configure a service Item for Out Patient Consulting Charge Item",
			)

		if self.user_id:
			self.validate_user_id()
		else:
			existing_user_id = frappe.db.get_value("Healthcare Practitioner", self.name, "user_id")
			if existing_user_id:
				frappe.permissions.remove_user_permission(
					"Healthcare Practitioner", self.name, existing_user_id
				)

		self.validate_practitioner_schedules()

	def on_update(self):
		if self.user_id:
			frappe.permissions.add_user_permission("Healthcare Practitioner", self.name, self.user_id)

	def set_full_name(self):
		if self.last_name:
			self.practitioner_name = " ".join(filter(None, [self.first_name, self.last_name]))
		else:
			self.practitioner_name = self.first_name

	def validate_practitioner_schedules(self):
		for practitioner_schedule in self.practitioner_schedules:
			if frappe.db.get_value(
				"Practitioner Schedule", practitioner_schedule.schedule, "allow_video_conferencing"
			):

				if not self.google_calendar and not frappe.db.get_single_value(
					"Healthcare Settings", "default_google_calendar"
				):
					frappe.throw(
						_(
							"Video conferencing enabled for {}, \
											please link {} or configure Default Google Calendar in {}"
						).format(
							get_link_to_form("Practitioner Schedule", practitioner_schedule.schedule),
							frappe.bold("Google Calendar"),
							get_link_to_form("Healthcare Settings", "Healthcare Settings", "Healthcare Settings"),
						),
						title=_("Google Calendar Required"),
					)
				break

	def validate_user_id(self):
		if not frappe.db.exists("User", self.user_id):
			frappe.throw(_("User {0} does not exist").format(self.user_id))
		elif not frappe.db.exists("User", self.user_id, "enabled"):
			frappe.throw(_("User {0} is disabled").format(self.user_id))

		# check duplicate
		practitioner = frappe.db.exists(
			"Healthcare Practitioner", {"user_id": self.user_id, "name": ("!=", self.name)}
		)
		if practitioner:
			frappe.throw(
				_("User {0} is already assigned to Healthcare Practitioner {1}").format(
					self.user_id, practitioner
				)
			)

	def on_trash(self):
		delete_contact_and_address("Healthcare Practitioner", self.name)


def validate_service_item(item, msg):
	if frappe.db.get_value("Item", item, "is_stock_item"):
		frappe.throw(_(msg))


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_practitioner_list(doctype, txt, searchfield, start, page_len, filters=None):

	active_filter = {"status": "Active"}

	filters = {**active_filter, **filters} if filters else active_filter

	fields = ["name", "practitioner_name", "mobile_phone"]

	text_in = {"name": ("like", "%%%s%%" % txt), "practitioner_name": ("like", "%%%s%%" % txt)}

	return frappe.get_all(
		"Healthcare Practitioner",
		fields=fields,
		filters=filters,
		or_filters=text_in,
		start=start,
		page_length=page_len,
		order_by="name, practitioner_name",
		as_list=1,
	)


@frappe.whitelist()
def get_supplier_and_user(user_id=None, supplier=None):
	"""
	if user_id or supplier is passed, return both supplier and user_id
	"""

	if not user_id and not supplier:
		return None

	con = frappe.qb.DocType("Contact")
	dlink = frappe.qb.DocType("Dynamic Link")

	supplier_and_user = (
		frappe.qb.from_(con)
		.join(dlink)
		.on(con.name == dlink.parent)
		.select((con.user).as_("user"), (dlink.link_name).as_("supplier"))
		.where(dlink.link_doctype == "Supplier")
		.where((dlink.link_name == supplier) | (con.user == user_id))
		.run(as_dict=True)
	)

	return supplier_and_user[0] if supplier_and_user else None
