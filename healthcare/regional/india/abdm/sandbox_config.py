def get_urls():
	return {
		"authorization": ['POST', "v0.5/sessions"],
		"exists_by_health_id": ['POST', "v1/search/existsByHealthId"],
		"verify_health_id": ['POST', "v1/search/searchByHealthId"],
		"generate_aadhaar_otp": ['POST', "v1/registration/aadhaar/generateOtp"],
		"generate_mobile_otp": ['POST', "v2/registration/mobile/generateOtp"],
		"verify_mobile_otp": ['POST', "v2/registration/mobile/verifyOtp"],
		"resend_mobile_otp": ['POST', "v2/registration/mobile/resendOtp"],
		"resend_aadhaar_otp": ['POST', "v2/registration/aadhaar/resendAadhaarOtp"],
		"create_abha_w_aadhaar": ['POST', "v1/registration/aadhaar/createHealthIdWithAadhaarOtp"],
		"create_abha_w_mobile": ['POST', "v2/registration/mobile/createHidViaMobile"],
		"auth_cert": ['GET', "v2/auth/cert"]
	}
