# Copyright (c) 2015, ESS LLP and Contributors
# See license.txt


import os

import frappe
from frappe.utils import add_days, getdate, nowdate

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_patient,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestPatient(HealthcareTestSuite):
	def test_customer_created(self):
		frappe.db.set_single_value("Healthcare Settings", "link_customer_to_patient", 1)
		patient = "_Test Patient"
		self.assertTrue(frappe.db.get_value("Patient", patient, "customer"))

	def test_patient_registration(self):
		registration_item = "_Test Registration"
		settings = frappe.get_single("Healthcare Settings")
		settings.collect_registration_fee = 1
		settings.registration_item = registration_item
		settings.registration_fee = 500
		settings.save()

		patient = create_patient()
		patient = frappe.get_doc("Patient", patient)
		self.assertEqual(patient.status, "Disabled")

		frappe.db.set_single_value("Global Defaults", "default_company", "_Test Company")
		# check sales invoice and patient status
		result = patient.invoice_patient_registration()
		self.assertTrue(frappe.db.exists("Sales Invoice", result.get("name")))

		invoice_doc = frappe.get_doc("Sales Invoice", result.get("name"))
		self.assertTrue(invoice_doc.status, "Draft")

		invoice_doc.submit()
		self.assertTrue(patient.status, "Active")

		settings.collect_registration_fee = 0
		settings.save()

	def test_patient_contact(self):
		frappe.db.sql("""delete from `tabPatient` where name like '_Test Contact Patient%'""")
		frappe.db.sql("""delete from `tabCustomer` where name like '_Test Contact Patient%'""")
		frappe.db.sql("""delete from `tabContact` where name like'_Test Contact Patient%'""")
		frappe.db.sql("""delete from `tabDynamic Link` where parent like '_Test Contact Patient%'""")

		patient = create_patient(
			patient_name="_Test Contact Patient", email="test-patient@example.com", mobile="+91 0000000001"
		)
		customer = frappe.db.get_value("Patient", patient, "customer")
		self.assertTrue(customer)
		self.assertTrue(
			frappe.db.exists(
				"Dynamic Link", {"parenttype": "Contact", "link_doctype": "Patient", "link_name": patient}
			)
		)
		self.assertTrue(
			frappe.db.exists(
				"Dynamic Link", {"parenttype": "Contact", "link_doctype": "Customer", "link_name": customer}
			)
		)

		# a second patient linking with same customer
		new_patient = create_patient(
			email="test-patient@example.com", mobile="+91 0000000009", customer=customer
		)
		self.assertTrue(
			frappe.db.exists(
				"Dynamic Link", {"parenttype": "Contact", "link_doctype": "Patient", "link_name": new_patient}
			)
		)
		self.assertTrue(
			frappe.db.exists(
				"Dynamic Link", {"parenttype": "Contact", "link_doctype": "Customer", "link_name": customer}
			)
		)

	def test_patient_user(self):
		frappe.db.sql("""delete from `tabUser` where email='test-patient-user@example.com'""")
		frappe.db.sql("""delete from `tabDynamic Link` where parent like '_Test User Patient%'""")
		frappe.db.sql("""delete from `tabPatient` where name like '_Test User Patient%'""")

		patient = create_patient(
			patient_name="_Test User Patient",
			email="test-patient-user@example.com",
			mobile="+91 0000000009",
			create_user=True,
		)
		user = frappe.db.get_value("Patient", patient, "user_id")
		self.assertTrue(frappe.db.exists("User", user))

		new_patient = frappe.get_doc(
			{
				"doctype": "Patient",
				"first_name": "_Test Patient Duplicate User",
				"sex": "Male",
				"email": "test-patient-user@example.com",
				"mobile": "+91 0000000009",
				"invite_user": 1,
				"customer_group": "Individual",
			}
		)

		self.assertRaises(frappe.exceptions.DuplicateEntryError, new_patient.insert)

	def test_patient_image_update_should_update_customer_image(self):
		settings = frappe.get_single("Healthcare Settings")
		settings.link_customer_to_patient = 1
		settings.save()

		patient_name = create_patient()
		patient = frappe.get_doc("Patient", patient_name)
		patient.image = os.path.abspath("assets/frappe/images/default-avatar.png")
		patient.save()

		customer = frappe.get_doc("Customer", patient.customer)
		self.assertEqual(customer.image, patient.image)

	def test_multiple_patients_linked_with_same_customer(self):
		frappe.db.sql("""delete from `tabPatient`""")
		frappe.db.set_single_value("Healthcare Settings", "link_customer_to_patient", 1)

		patient_name_1 = create_patient(patient_name="John Doe")
		p1_customer_name = frappe.get_value("Patient", patient_name_1, "customer")
		p1_customer = frappe.get_doc("Customer", p1_customer_name)
		self.assertEqual(p1_customer.customer_name, "John Doe")

		patient_name_2 = create_patient(patient_name="Jane Doe", customer=p1_customer.name)
		p2_customer_name = frappe.get_value("Patient", patient_name_2, "customer")
		p2_customer = frappe.get_doc("Customer", p2_customer_name)

		self.assertEqual(p1_customer_name, p2_customer_name)
		self.assertEqual(p2_customer.customer_name, "John Doe")

	def test_future_dob_not_allowed(self):
		patient = frappe.new_doc("Patient")
		patient.first_name = "Future Born"
		patient.sex = "Female"
		patient.dob = add_days(nowdate(), 1)

		self.assertRaises(frappe.ValidationError, patient.insert)

		patient.dob = nowdate()
		patient.insert()
		self.assertEqual(getdate(patient.dob), getdate())
