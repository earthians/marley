import frappe
import responses
from frappe.tests.utils import FrappeTestCase

from healthcare.regional.india.abdm.utils import abdm_request


class TestPatient(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()

		doc = frappe.get_doc(
			{
				"doctype": "ABDM Settings",
				"default": 1,
				"auth_base_url": "https://dev.abdm.gov.in/gateway/",
				"health_id_base_url": "https://healthidsbx.abdm.gov.in/api/",
				"Company": frappe.defaults.get_user_default("Company"),
			}
		)
		doc.insert()

	@responses.activate
	def test_aadhar_otp_flow(self):
		responses.add(
			responses.POST,
			"https://dev.abdm.gov.in/gateway/v0.5/sessions",
			json={"accessToken": "foo.bar"},
			status=200,
		)
		responses.add(
			responses.POST,
			"https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/generateOtp",
			json={"txnId": "37ca-41de"},
			status=200,
		)

		payload = {"aadhaar": "123400001234"}
		response = abdm_request(payload, "generate_aadhaar_otp", "Health ID")
		assert "txnId" in response
