import responses

from healthcare.regional.india.abdm.utils import abdm_request
from healthcare.tests.utils import HealthcareTestSuite, healthcare_owns_abdm_settings


class TestPatient(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		if not healthcare_owns_abdm_settings():
			self.skipTest("another app replaces ABDM Settings on this site")

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
		with self.set_user("abdm_user@marleyhealth.io"):
			response = abdm_request(payload, "generate_aadhaar_otp", "Health ID")
		assert "txnId" in response
