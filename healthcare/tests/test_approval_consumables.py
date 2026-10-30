# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.permissions import add_user_permission

from healthcare.healthcare.doctype.observation.approval_consumables import (
	get_approval_consumables,
	update_approval_consumables,
)
from healthcare.healthcare.doctype.observation.observation import set_observation_status
from healthcare.healthcare.doctype.observation.observation_consumables import get_service_unit_type
from healthcare.tests.test_observation_consumables import WAREHOUSE, make_stock_item, receive, stock_qty
from healthcare.tests.test_observation_stock import (
	ANALYSER,
	REAGENT,
	TUBE,
	make_unit_type,
	new_observation,
	reagent_template,
	service_request_for,
)
from healthcare.tests.utils import HealthcareTestSuite

APPROVER = "lab_approver@marleyhealth.io"


class TestApprovalConsumables(HealthcareTestSuite):
	def setUp(self):
		for item in (REAGENT, TUBE):
			make_stock_item(item)
			receive(item, 5)

	def test_approving_a_panel_shows_its_components_reagents_too(self):
		panel = new_observation(reagent_template("Approval Panel"), warehouse=WAREHOUSE)
		component = new_observation(reagent_template("Approval Component"), parent_observation=panel.name)

		rows = get_approval_consumables(observation=panel.name)

		self.assertEqual({row.parent for row in rows}, {panel.name, component.name})
		self.assertTrue(all(row.item_code == REAGENT and row.warehouse == WAREHOUSE for row in rows))

	def test_a_panel_of_more_than_a_page_shows_every_component(self):
		"""frappe.get_list is documented to stop at 20 rows; approval issues them all."""
		panel = new_observation(reagent_template("Approval Large Panel"))
		template = reagent_template("Approval Large Component")
		for _ in range(21):
			new_observation(template, parent_observation=panel.name)

		rows = get_approval_consumables(observation=panel.name)

		self.assertEqual(len({row.parent for row in rows}), 22)

	def test_an_issued_observation_shows_nothing(self):
		observation = new_observation(reagent_template("Approval Issued"), warehouse=WAREHOUSE)
		set_observation_status(observation.name, "Approved")

		self.assertEqual(get_approval_consumables(observation=observation.name), [])

	def test_edited_quantities_are_what_approval_issues(self):
		observation = new_observation(reagent_template("Approval Edited"), warehouse=WAREHOUSE)
		row = get_approval_consumables(observation=observation.name)[0]
		before = stock_qty(REAGENT)

		update_approval_consumables([{"row_name": row.row_name, "qty": 1}])
		set_observation_status(observation.name, "Approved")

		self.assertEqual(stock_qty(REAGENT), before - 1)

	def test_an_approved_observation_cannot_be_edited(self):
		observation = new_observation(reagent_template("Approval Locked"), warehouse=WAREHOUSE)
		row = get_approval_consumables(observation=observation.name)[0]
		set_observation_status(observation.name, "Approved")

		with self.assertRaises(frappe.ValidationError):
			update_approval_consumables([{"row_name": row.row_name, "qty": 1}])

	def test_a_form_open_before_the_review_cannot_overwrite_it(self):
		observation = new_observation(reagent_template("Overwritten Review Guard"), warehouse=WAREHOUSE)
		open_form = frappe.get_doc("Observation", observation.name)
		row = get_approval_consumables(observation=observation.name)[0]

		update_approval_consumables([{"row_name": row.row_name, "qty": 1}])

		open_form.consumables[0].qty = 3
		with self.assertRaises(frappe.TimestampMismatchError):
			open_form.save()


class TestApprovalAccess(HealthcareTestSuite):
	"""A lab approver limited to one patient sees only what they may open."""

	def setUp(self):
		# The templates also list a tube; a fresh site has none until a test makes it.
		for item in (REAGENT, TUBE):
			make_stock_item(item)
		make_unit_type(ANALYSER)
		make_unit_type("_Test Consumables Ultrasound")
		self.allowed = frappe.db.get_value("Patient", {"name": ["!=", "_Test Patient"]})
		make_approver()
		frappe.db.delete("User Permission", {"user": APPROVER})
		add_user_permission("Patient", self.allowed, APPROVER)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.delete("User Permission", {"user": APPROVER})

	def test_another_patients_observation_is_refused(self):
		observation = new_observation(reagent_template("Access Refused"))
		frappe.set_user(APPROVER)

		with self.assertRaises(frappe.PermissionError):
			get_approval_consumables(observation=observation.name)

	def test_a_component_the_approver_cannot_read_is_left_out(self):
		panel = new_observation(reagent_template("Access Panel"), patient=self.allowed)
		new_observation(reagent_template("Access Component"), parent_observation=panel.name)
		frappe.set_user(APPROVER)

		rows = get_approval_consumables(observation=panel.name)

		self.assertEqual({row.parent for row in rows}, {panel.name})

	def test_a_report_shows_only_the_patients_the_approver_may_read(self):
		report = make_report(self.allowed)
		allowed = invoiced_observation(reagent_template("Access Report Allowed"), report, self.allowed)
		invoiced_observation(reagent_template("Access Report Refused"), report, "_Test Patient")
		frappe.set_user(APPROVER)

		rows = get_approval_consumables(diagnostic_report=report.name)

		self.assertEqual({row.parent for row in rows}, {allowed.name})

	def test_another_patients_report_is_refused(self):
		report = make_report("_Test Patient")
		frappe.set_user(APPROVER)

		with self.assertRaises(frappe.PermissionError):
			get_approval_consumables(diagnostic_report=report.name)

	def test_an_unreadable_service_request_is_ignored(self):
		template = reagent_template("Access Doppler", unit_type=ANALYSER)
		request = service_request_for(template, "_Test Consumables Ultrasound")
		frappe.set_user(APPROVER)

		self.assertEqual(get_service_unit_type(template.name, request), ANALYSER)

	def test_a_request_behind_a_readable_observation_is_used(self):
		template = reagent_template("Access Scan", unit_type=ANALYSER)
		request = service_request_for(template, "_Test Consumables Ultrasound")
		new_observation(template, patient=self.allowed, service_request=request)
		frappe.set_user(APPROVER)

		self.assertEqual(get_service_unit_type(template.name, request), "_Test Consumables Ultrasound")


def make_report(patient):
	"""A report on an invoice that only names it; the Sales Invoice itself is not needed."""
	report = frappe.get_doc(
		{
			"doctype": "Diagnostic Report",
			"patient": patient,
			"company": "_Test Company",
			"ref_doctype": "Sales Invoice",
			"docname": frappe.generate_hash(length=10),
		}
	)
	report.flags.ignore_links = True
	return report.insert(ignore_permissions=True)


def invoiced_observation(template, report, patient):
	"""Set directly: an invoiced Observation must also carry fields this test does not need."""
	observation = new_observation(template, patient=patient)
	observation.db_set("sales_invoice", report.docname)
	return observation


def make_approver():
	if frappe.db.exists("User", APPROVER):
		return
	frappe.get_doc(
		{
			"doctype": "User",
			"email": APPROVER,
			"first_name": "approver",
			"send_welcome_email": 0,
			"roles": [{"role": "LabTest Approver"}],
		}
	).insert(ignore_permissions=True)
