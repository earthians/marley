def get_urls():
    return {
        "authorization": ['POST', "v0.5/sessions"],
        "exists_by_health_id": ['POST', "v1/search/existsByHealthId"],
        "verify_health_id": ['POST', "v1/search/searchByHealthId"],
        "generate_aadhaar_otp": ['POST', "v1/registration/aadhaar/generateOtp"],
        "create_abha_w_aadhaar": ['POST', "v1/registration/aadhaar/createHealthIdWithAadhaarOtp"]
    }
