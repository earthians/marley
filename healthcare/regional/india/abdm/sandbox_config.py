
config = {
	"authorization": {'method':'POST', 'url': 'v0.5/sessions', 'encrypted': False},
	"exists_by_health_id": {'method':'POST', 'url': 'v1/search/existsByHealthId', 'encrypted': False},
	"verify_health_id": {'method':'POST', 'url': 'v1/search/searchByHealthId', 'encrypted': False},
	"generate_aadhaar_otp": {'method':'POST', 'url': 'v1/registration/aadhaar/generateOtp', 'encrypted': False},
	"generate_mobile_otp": {'method':'POST', 'url': 'v2/registration/mobile/generateOtp', 'encrypted': False},
	"verify_mobile_otp": {'method':'POST', 'url': 'v2/registration/mobile/verifyOtp', 'encrypted': True},
	"resend_mobile_otp": {'method':'POST', 'url': 'v2/registration/mobile/resendOtp', 'encrypted': False},
	"resend_aadhaar_otp": {'method':'POST', 'url': 'v2/registration/aadhaar/resendAadhaarOtp', 'encrypted': False},
	"create_abha_w_aadhaar": {'method':'POST', 'url': 'v1/registration/aadhaar/createHealthIdWithAadhaarOtp', 'encrypted': False},
	"create_abha_w_mobile": {'method':'POST', 'url': 'v2/registration/mobile/createHidViaMobile', 'encrypted': False},
	"auth_cert": {'method':'GET', 'url': 'v2/auth/cert', 'encrypted': False}
}

def get_url_for(key):
	return config.get(key)