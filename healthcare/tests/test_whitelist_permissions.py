# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import json

import frappe

from healthcare.controllers.service_request_controller import set_request_status
from healthcare.healthcare.api.patient_portal import make_appointment
from healthcare.healthcare.doctype.clinical_procedure.clinical_procedure import (
	get_procedure_prescribed as get_procedures_to_perform,
)
from healthcare.healthcare.doctype.clinical_procedure_template.clinical_procedure_template import (
	change_item_code_from_template,
)
from healthcare.healthcare.doctype.emergency_record.emergency_record import get_active_triage
from healthcare.healthcare.doctype.healthcare_service_unit_type.healthcare_service_unit_type import (
	change_item_code,
)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_sms_text
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	schedule_discharge,
	schedule_inpatient,
	set_ip_order_cancelled,
)
from healthcare.healthcare.doctype.lab_test.lab_test import get_lab_test_prescribed
from healthcare.healthcare.doctype.lab_test.lab_test import update_status as update_lab_test_status
from healthcare.healthcare.doctype.lab_test_template.lab_test_template import change_test_code_from_template
from healthcare.healthcare.doctype.medication.medication import change_item_code_from_medication
from healthcare.healthcare.doctype.medication_request.medication_request import (
	set_medication_request_status,
)
from healthcare.healthcare.doctype.observation.observation import add_note, add_observation, new_observation
from healthcare.healthcare.doctype.patient.patient import get_patient_detail
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	get_prescribed_therapies,
	get_procedure_prescribed,
)
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	update_status as update_appointment_status,
)
from healthcare.healthcare.doctype.patient_encounter.patient_encounter import (
	create_medication_request,
	get_encounter_details,
)
from healthcare.healthcare.doctype.sample_collection.sample_collection import create_observation
from healthcare.healthcare.doctype.service_request.service_request import (
	set_service_request_status,
	update_service_request_status,
)
from healthcare.healthcare.doctype.therapy_type.therapy_type import change_item_code_from_therapy
from healthcare.healthcare.doctype.treatment_counselling.treatment_counselling import (
	create_ip_from_treatment_counselling,
)
from healthcare.healthcare.page.patient_history.patient_history import get_feed, get_feed_for_dt
from healthcare.healthcare.page.patient_progress import patient_progress
from healthcare.healthcare.utils import (
	get_healthcare_services_to_invoice,
	get_patient_vitals,
	render_doc_as_html,
)
from healthcare.regional.india.abdm.utils import abdm_request, get_health_data
from healthcare.tests.utils import HealthcareTestSuite

NOBODY = "test_user@marleyhealth.io"  # a login with no clinical role at all
PHYSICIAN = "gp@marleyhealth.io"  # a Physician from the healthcare test fixtures
NURSE = "nurse_permissions@marleyhealth.io"
LAB_USER = "lab_permissions@marleyhealth.io"  # may submit a Lab Test, but has no access to its request


def stored(doctype, **fields):
	"""A bare row to point an endpoint at. These tests are about who may call
	the endpoint, so the document does not need to pass its own validation."""
	doc = frappe.get_doc({"doctype": doctype, **fields})
	doc.set_new_name()
	doc.db_insert()
	return doc.name


def make_user(email, role):
	if frappe.db.exists("User", email):
		return
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": role,
			"send_welcome_email": 0,
			"roles": [{"role": role}],
		}
	).insert(ignore_permissions=True)


class WhitelistPermissionTestCase(HealthcareTestSuite):
	"""Calls whitelisted endpoints as a login with no clinical role."""

	def setUp(self):
		super().setUp()
		self.patient = frappe.get_all("Patient", pluck="name", limit=1)[0]

	def tearDown(self):
		frappe.set_user("Administrator")

	def assert_denied(self, endpoint, *args, **kwargs):
		frappe.set_user(NOBODY)
		self.assertRaises(frappe.PermissionError, endpoint, *args, **kwargs)
		frappe.set_user("Administrator")


class TestStatusEndpoints(WhitelistPermissionTestCase):
	def test_request_status_is_limited_to_request_doctypes(self):
		self.assertRaises(frappe.PermissionError, set_request_status, "User", NOBODY, "Disabled")

	def test_request_status_needs_write_on_the_request(self):
		request = stored("Service Request", patient=self.patient, status="active-Request Status")

		self.assert_denied(set_request_status, "Service Request", request, "on-hold-Request Status")
		self.assertEqual(frappe.db.get_value("Service Request", request, "status"), "active-Request Status")

	def test_request_status_still_works_for_a_permitted_user(self):
		request = stored("Service Request", patient=self.patient, status="active-Request Status")

		set_request_status("Service Request", request, "on-hold-Request Status")

		self.assertEqual(frappe.db.get_value("Service Request", request, "status"), "on-hold-Request Status")

	def test_service_request_status_needs_write(self):
		request = stored("Service Request", patient=self.patient)

		self.assert_denied(set_service_request_status, request, "revoked-Request Status")

	def test_medication_request_status_needs_write(self):
		request = stored("Medication Request", patient=self.patient)

		self.assert_denied(set_medication_request_status, request, "revoked-Medication Request Status")

	def test_lab_test_status_needs_write(self):
		lab_test = stored("Lab Test", patient=self.patient, status="Draft")

		self.assert_denied(update_lab_test_status, "Approved", lab_test)
		self.assertEqual(frappe.db.get_value("Lab Test", lab_test, "status"), "Draft")

	def test_appointment_status_needs_write(self):
		appointment = stored("Patient Appointment", patient=self.patient, status="Scheduled")

		self.assert_denied(update_appointment_status, appointment, "Closed")

	def test_observation_note_needs_write(self):
		observation = stored("Observation", patient=self.patient)

		self.assert_denied(add_note, "tampered", observation)
		self.assertFalse(frappe.db.get_value("Observation", observation, "note"))


class TestWriteEndpoints(WhitelistPermissionTestCase):
	def test_adding_an_observation_needs_create(self):
		self.assert_denied(add_observation, patient=self.patient, result="tampered")

	def test_scheduling_an_admission_needs_create(self):
		self.assert_denied(schedule_inpatient, json.dumps({"patient": self.patient}))

	def test_admitting_from_counselling_needs_create(self):
		counselling = stored("Treatment Counselling", patient=self.patient, status="Active")

		self.assert_denied(create_ip_from_treatment_counselling, "{}", counselling)

	def test_admitting_from_counselling_needs_write_on_the_counselling(self):
		counselling = stored("Treatment Counselling", patient=self.patient, status="Active")
		frappe.set_user(PHYSICIAN)  # may create an admission, but not edit counselling

		self.assertRaises(frappe.PermissionError, create_ip_from_treatment_counselling, "{}", counselling)
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Treatment Counselling", counselling, "status"), "Active")

	def test_scheduling_a_discharge_needs_write(self):
		admission = stored("Inpatient Record", patient=self.patient, status="Admitted")
		frappe.db.set_value("Patient", self.patient, "inpatient_record", admission)

		self.assert_denied(schedule_discharge, json.dumps({"patient": self.patient}))
		self.assertEqual(frappe.db.get_value("Inpatient Record", admission, "status"), "Admitted")

	def test_cancelling_an_admission_needs_write(self):
		admission = stored("Inpatient Record", patient=self.patient, status="Admission Scheduled")

		self.assert_denied(set_ip_order_cancelled, admission, "tampered")
		self.assertEqual(frappe.db.get_value("Inpatient Record", admission, "status"), "Admission Scheduled")


class TestItemRenameEndpoints(WhitelistPermissionTestCase):
	def setUp(self):
		super().setUp()
		self.item = self.stored_item("_Test Permission Item")
		self.new_code = frappe.generate_hash(length=10)

	def stored_item(self, item_code):
		if not frappe.db.exists("Item", item_code):
			stored(
				"Item",
				item_code=item_code,
				item_name=item_code,
				item_group="All Item Groups",
				stock_uom="Nos",
			)
		return item_code

	def as_json(self, doctype, **fields):
		return json.dumps({"name": stored(doctype, **fields), **fields})

	def assert_item_kept(self):
		self.assertTrue(frappe.db.exists("Item", self.item))

	def test_therapy_type_rename_needs_write(self):
		doc = self.as_json("Therapy Type", therapy_type=self.new_code, item=self.item)

		self.assert_denied(change_item_code_from_therapy, self.new_code, doc)
		self.assert_item_kept()

	def test_procedure_template_rename_needs_write(self):
		doc = self.as_json("Clinical Procedure Template", template=self.new_code, item=self.item)

		self.assert_denied(change_item_code_from_template, self.new_code, doc)
		self.assert_item_kept()

	def test_lab_test_template_rename_needs_write(self):
		doc = self.as_json(
			"Lab Test Template", lab_test_code=self.new_code, lab_test_name=self.new_code, item=self.item
		)

		self.assert_denied(change_test_code_from_template, self.new_code, doc)
		self.assert_item_kept()

	def test_medication_rename_needs_write(self):
		doc = self.as_json("Medication", generic_name=self.new_code, item_code=self.item)

		self.assert_denied(change_item_code_from_medication, self.new_code, doc)
		self.assert_item_kept()

	def test_service_unit_type_rename_needs_write(self):
		unit_type = stored("Healthcare Service Unit Type", service_unit_type=self.new_code, item=self.item)

		self.assert_denied(change_item_code, self.item, self.new_code, unit_type)
		self.assert_item_kept()

	def test_rename_uses_the_linked_item_not_the_one_sent(self):
		linked = self.stored_item(frappe.generate_hash(length=10))
		unit_type = stored("Healthcare Service Unit Type", service_unit_type=self.new_code, item=linked)

		change_item_code(self.item, self.new_code, unit_type)

		self.assertTrue(frappe.db.exists("Item", self.new_code))
		self.assertFalse(frappe.db.exists("Item", linked))
		self.assert_item_kept()


class TestPortalAndGatewayEndpoints(WhitelistPermissionTestCase):
	def test_a_portal_user_cannot_book_for_someone_elses_patient(self):
		self.assert_denied(make_appointment, "any", self.patient, "2030-01-01", "10:00")

	def test_the_abdm_gateway_needs_patient_write(self):
		self.assert_denied(abdm_request, {}, "verify_health_id", "Health ID")

	def test_abdm_health_data_needs_patient_write(self):
		self.assert_denied(get_health_data, "123456", "any", "Aadhaar")

	def test_the_abdm_token_is_not_callable_from_the_client(self):
		from healthcare.regional.india.abdm import utils

		self.assertNotIn(utils.get_authorization_token, frappe.whitelisted)


class TestTrustedInternalPaths(WhitelistPermissionTestCase):
	"""Clinical hooks write records the user has no direct access to."""

	def setUp(self):
		super().setUp()
		make_user(LAB_USER, "Laboratory User")

	def test_a_lab_user_cannot_set_a_request_status_directly(self):
		request = stored("Service Request", patient=self.patient)
		frappe.set_user(LAB_USER)

		self.assertRaises(
			frappe.PermissionError, set_service_request_status, request, "completed-Request Status"
		)

	def test_a_lab_test_hook_still_completes_its_request(self):
		request = stored("Service Request", patient=self.patient, status="active-Request Status")
		frappe.set_user(LAB_USER)

		update_service_request_status(request, "completed-Request Status")

		frappe.set_user("Administrator")
		self.assertEqual(
			frappe.db.get_value("Service Request", request, "status"), "completed-Request Status"
		)

	def test_a_lab_user_cannot_add_an_observation_directly(self):
		frappe.set_user(LAB_USER)

		self.assertRaises(frappe.PermissionError, add_observation, patient=self.patient)

	def test_sample_collection_still_creates_observations_for_a_lab_user(self):
		template = stored(
			"Observation Template",
			observation=frappe.generate_hash(length=10),
			permitted_data_type="Quantity",
			observation_category="Laboratory",
		)
		company = frappe.get_all("Company", pluck="name", limit=1)[0]
		frappe.set_user(LAB_USER)

		observation = new_observation(patient=self.patient, template=template, company=company)

		frappe.set_user("Administrator")
		self.assertTrue(frappe.db.exists("Observation", observation))

	def test_marking_a_sample_collected_needs_write_on_the_collection(self):
		collection = stored("Sample Collection", patient=self.patient)

		self.assert_denied(create_observation, "[]", collection)


class TestPatientDataReads(WhitelistPermissionTestCase):
	"""Endpoints that return a patient's records need read access to the patient."""

	def setUp(self):
		super().setUp()
		make_user(LAB_USER, "Laboratory User")

	def test_patient_detail_needs_patient_read(self):
		self.assert_denied(get_patient_detail, self.patient)

	def test_a_lab_user_still_gets_patient_detail_for_the_lab_test_form(self):
		frappe.set_user(LAB_USER)

		self.assertEqual(get_patient_detail(self.patient)["name"], self.patient)

	def test_vitals_need_patient_read(self):
		self.assert_denied(get_patient_vitals, self.patient)

	def test_history_feed_needs_patient_read(self):
		self.assert_denied(get_feed, self.patient)

	def test_a_lab_user_cannot_read_the_history_feed(self):
		frappe.set_user(LAB_USER)

		self.assertRaises(frappe.PermissionError, get_feed, self.patient)

	def test_a_nurse_can_read_the_history_feed(self):
		make_user(NURSE, "Nursing User")
		frappe.set_user(NURSE)

		self.assertIsInstance(get_feed(self.patient), list)

	def test_feed_for_a_document_needs_read_on_it(self):
		self.assert_denied(get_feed_for_dt, "Patient", self.patient)

	def test_rendering_a_document_needs_read_on_it(self):
		self.assert_denied(render_doc_as_html, "User", "Administrator")

	def test_encounter_details_need_patient_read(self):
		self.assert_denied(get_encounter_details, json.dumps({"patient": self.patient}))

	def test_a_lab_user_cannot_read_the_encounter_notes(self):
		frappe.set_user(LAB_USER)

		self.assertRaises(
			frappe.PermissionError, get_encounter_details, json.dumps({"patient": self.patient})
		)

	def test_active_triage_needs_patient_read(self):
		self.assert_denied(get_active_triage, self.patient)

	def test_sms_text_needs_lab_test_read(self):
		lab_test = stored("Lab Test", patient=self.patient)

		self.assert_denied(get_sms_text, lab_test)

	def test_prescriptions_need_patient_read(self):
		for endpoint in (
			get_lab_test_prescribed,
			get_procedures_to_perform,
			get_procedure_prescribed,
			get_prescribed_therapies,
		):
			with self.subTest(endpoint=endpoint.__qualname__):
				self.assert_denied(endpoint, self.patient)

	def test_patient_progress_needs_patient_read(self):
		calls = {
			"get_therapy_sessions_count": (),
			"get_patient_heatmap_data": ("2026-01-01",),
			"get_therapy_sessions_distribution_data": ("therapy_type",),
			"get_therapy_progress_data": ("any", "Last Month"),
			"get_patient_assessment_data": ("any", "Last Month"),
			"get_therapy_assessment_correlation_data": ("any", "Last Month"),
			"get_assessment_parameter_data": ("any", "Last Month"),
		}
		for name, args in calls.items():
			with self.subTest(endpoint=name):
				self.assert_denied(getattr(patient_progress, name), self.patient, *args)


class TestMedicationRequestCreation(WhitelistPermissionTestCase):
	"""Orders are created from an encounter, so the caller must be allowed to edit it."""

	def setUp(self):
		super().setUp()
		self.encounter = stored("Patient Encounter", patient=self.patient)

	def requests(self):
		return frappe.db.count("Medication Request", {"order_group": self.encounter})

	def test_creating_medication_requests_needs_write_on_the_encounter(self):
		self.assert_denied(create_medication_request, self.encounter)
		self.assertEqual(self.requests(), 0)

	def test_a_nurse_cannot_create_medication_requests(self):
		make_user(NURSE, "Nursing User")
		frappe.set_user(NURSE)

		self.assertRaises(frappe.PermissionError, create_medication_request, self.encounter)


class TestBillableServices(WhitelistPermissionTestCase):
	"""The Sales Invoice "Get Items From > Healthcare Services" endpoint."""

	def setUp(self):
		super().setUp()
		self.company = frappe.get_all("Company", pluck="name", limit=1)[0]
		self.customer = frappe.get_all("Customer", pluck="name", limit=1)[0]

	def test_billable_services_need_sales_invoice_create(self):
		frappe.set_user(PHYSICIAN)  # may read the patient, but cannot invoice

		self.assertRaises(
			frappe.PermissionError,
			get_healthcare_services_to_invoice,
			self.patient,
			self.customer,
			self.company,
		)
