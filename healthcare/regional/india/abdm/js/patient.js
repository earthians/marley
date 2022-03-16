frappe.ui.form.on('Patient', {
	refresh: function (frm) {
		if (!frm.doc.phr_address) {
			frm.add_custom_button(__('Verify PHR Address'), function () {
				verify_health_id(frm)
			});
		}
		if (!frm.doc.abha_number) {
			frm.add_custom_button(__('Create ABHA'), function () {
				create_abha(frm)
			}).addClass("btn-primary");
		}
	}
});

let verify_health_id = function (frm) {
	let d = new frappe.ui.Dialog({
		title: 'Enter PHR Address',
		fields: [
			{
				label: 'PHR Address',
				fieldname: 'healthid',
				fieldtype: 'Data'
			}
		],
		primary_action_label: 'Get',
		primary_action(values) {
			frappe.call({
				method: 'healthcare.regional.india.abdm.utils.abdm_request',
				args: {
					'payload': {
						'healthId': d.get_value('healthid')
					},
					'url_key': 'verify_health_id',
					'req_type': 'Health ID'
				},
				freeze: true,
				freeze_message: __('Fetching PHR Address...'),
				callback: function (r) {
					if (r.message['healthIdNumber']) {
						frm.set_value('phr_address', r.message['healthId'])
						frm.set_value('abha_number', r.message['healthIdNumber'])
						frappe.show_alert({ message: __('ABHA ID verified Successfully'), indicator: 'green' }, 5);
						frm.save()
					} else {
						frappe.throw({ message: __("ABHA Id not found"), title: __("Not Found") });
					}
				}
			});
			d.hide();
		}
	});

	d.show();
}


let create_abha = function (frm) {
	let d = new frappe.ui.Dialog({
		title: 'Enter Aadhaar',
		fields: [
			{
				label: 'Mode',
				fieldname: 'mode',
				fieldtype: 'Select',
				options: ['Aadhaar', 'Mobile'],
				default: 'Aadhaar'
			},
			{
				label: 'Aadhaar',
				fieldname: 'aadhaar',
				fieldtype: 'Data',
				depends_on: "eval:doc.mode == 'Aadhaar'",
				mandatory_depends_on: "eval:doc.mode == 'Aadhaar'"
			},
			{
				label: 'Mobile',
				fieldname: 'mobile',
				fieldtype: 'Int',
				depends_on: "eval:doc.mode == 'Mobile'",
				mandatory_depends_on: "eval:doc.mode == 'Mobile'"
			},
		],
		primary_action_label: 'Send OTP',
		primary_action(values) {
			if (d.get_value('mode') == 'Aadhaar') {
				frappe.call({
					method: 'healthcare.regional.india.abdm.utils.abdm_request',
					args: {
						'payload': {
							"aadhaar": d.get_value('aadhaar')
						},
						'url_key': 'generate_aadhaar_otp',
						'req_type': 'Health ID'
					},
					freeze: true,
					freeze_message: __('Sending OTP...'),
					callback: function (r) {
						let txn_id = r.message['txnId'];
						if (txn_id) {
							let dialog = new frappe.ui.Dialog({
								title: 'OTP',
								fields: [{
									label: 'OTP',
									fieldname: 'otp',
									fieldtype: 'Data',
									reqd: 1
								},
								{
									label: '',
									fieldname: 'sb1',
									fieldtype: 'Section Break',
									hide_border: 1
								},
								{
									label: 'User Name',
									fieldname: 'username',
									fieldtype: 'Data'
								},
								{
									label: 'Verify User Name',
									fieldname: 'verify_user_name',
									fieldtype: 'Button'
								}
								// {
								// 	label: 'Password',
								// 	fieldname: 'password',
								// 	fieldtype: 'Data',
								// 	description: 'Must contain an uppercase, a lowercase, a number, a special character and at least 8 or more characters. It should not contain any sequences (like 123)'
								// },
								],
								primary_action_label: 'Create ABHA ID',
								primary_action(values) {
									frappe.call({
										method: 'healthcare.regional.india.abdm.utils.abdm_request',
										args: {
											'payload': {
												"email": frm.doc.email || '',
												"firstName": frm.doc.first_name || '',
												"lastName": frm.doc.last_name || '',
												"middleName": frm.doc.middle_name || '',
												"mobile": frm.doc.mobile || '',
												"otp": dialog.get_value('otp'),
												"password": dialog.get_value('password'),
												"txnId": r.message['txnId'],
												"username": dialog.get_value('username')
											},
											'url_key': 'create_abha_w_aadhaar',
											'req_type': 'Health ID'
										},
										freeze: true,
										freeze_message: __('<br><br><br>Creating Health ID <br><small>Please note, this may take a while</small>'),
										callback: function (data) {
											dialog.hide();
											if (data.message['healthIdNumber']) {
												frm.set_value('phr_address', data.message['healthId'])
												frm.set_value('abha_number', data.message['healthIdNumber'])
												frappe.show_alert({ message: __('ABHA ID created successfully'), indicator: 'green' }, 5);
												if (data.message['new'] == false) {
													frappe.show_alert({ message: __('Fetched existing ABHA of aadhaar provided'), indicator: 'green' }, 5);
												}
												frm.save()
											} else {
												frappe.throw({ message: __("ABHA ID not Created"), title: __("Not Created") });
											}
										}
									});
									dialog.hide();
								}
							});
							dialog.fields_dict.verify_user_name.input.onclick = function () {
								frappe.call({
									method: 'healthcare.regional.india.abdm.utils.abdm_request',
									args: {
										'payload': {
											"healthId": dialog.get_value('username')
										},
										'url_key': 'exists_by_health_id',
										'req_type': 'Health ID'
									},
									callback: function (data) {
										if (data.message['status'] == false) {
											frappe.show_alert({ message: __('ABHA ID is unique'), indicator: 'green' }, 5);
										} else if (data.message['status'] == true) {
											frappe.show_alert({ message: __('ABHA ID already existing'), indicator: 'red' }, 5);
										}

									}
								});
							}
							dialog.show();
						}
					}
				});
			} else if (d.get_value('mode') == 'Mobile') {
				frappe.call({
					method: 'healthcare.regional.india.abdm.utils.abdm_request',
					args: {
						'payload': {
							'mobile': d.get_value('mobile')
						},
						'url_key': 'generate_mobile_otp',
						'req_type': 'Health ID'
					},
					freeze: true,
					freeze_message: __('Sending OTP...'),
					callback: function (r) {
						let txn_id = r.message['txnId'];
						if (txn_id) {
							let dialog = new frappe.ui.Dialog({
								title: 'OTP',
								fields: [
									{
										label: 'OTP',
										fieldname: 'otp',
										fieldtype: 'Data',
										reqd: 1
									},
									{
										label: 'Resend OTP',
										fieldname: 'resend_otp',
										fieldtype: 'Button'
									},
									{
										label: 'Name',
										fieldname: 'name',
										fieldtype: 'Data',
										default: frm.doc.patient_name,
										reqd: 1
									},
									{
										label: 'Year of Birth',
										fieldname: 'yob',
										fieldtype: 'Int',
										default: new Date(frm.doc.dob).getFullYear(),
										reqd: 1
									},

								],
								primary_action_label: 'Create ABHA ID',
								primary_action(values) {
									frappe.call({
										method: 'healthcare.regional.india.abdm.utils.auth_cert_and_rsa_encryption',
										args: {
											'message': dialog.get_value('otp')
										},
										callback: function (data) {
											let otp_encrypted = data.message['encrypted_msg'];
											frappe.call({
												method: 'healthcare.regional.india.abdm.utils.abdm_request',
												args: {
													'payload': {
														'otp': otp_encrypted,
														'txnId': txn_id
													},
													'url_key': 'verify_mobile_otp',
													'req_type': 'Health ID'
												},
												freeze: true,
												freeze_message: __('<br><br><br>Creating Health ID <br><small>Please note, this may take a while</small>'),
												callback: function (r) {
													if (!r.message['token']) {
														frappe.show_alert({
															message:__('Incorrect OTP entered, Please Re-enter OTP'),
															indicator:'red'
														}, 10);
													} else {
														frappe.call({
															method: 'healthcare.regional.india.abdm.utils.abdm_request',
															args: {
																'payload': {
																	"email": frm.doc.email || '',
																	"firstName": frm.doc.first_name || '',
																	"lastName": frm.doc.last_name || '',
																	"middleName": frm.doc.middle_name || '',
																	"mobile": frm.doc.mobile || '',
																	"txnId": txn_id,
																	"gender": (frm.doc.sex == 'Male') ? 'M' : (frm.doc.sex == 'Female') ? 'F' : (frm.doc.sex == 'Prefer not to say') ? 'U' : 'O',
																	"name": dialog.get_value('name'),
																	"yearOfBirth": dialog.get_value('yob')
																},
																'url_key': 'create_abha_w_mobile',
																'req_type': 'Health ID',
																'rec_headers': {
																	'T-Token': r.message['token']
																}
															},
															callback: function (data) {
																dialog.hide();
																if (data.message['healthIdNumber']) {
																	frm.set_value('phr_address', data.message['healthId'])
																	frm.set_value('abha_number', data.message['healthIdNumber'])
																	frappe.show_alert({ message: __('ABHA ID created successfully'), indicator: 'green' }, 5);
																	frm.save()
																} else {
																	frappe.throw({ message: __("ABHA ID not Created"), title: __("Not Created") });
																}
															}
														});
													}
												}
											})
										}
									});
									dialog.hide();
								}
							});
							dialog.fields_dict.resend_otp.input.onclick = function () {
								frappe.call({
									method: 'healthcare.regional.india.abdm.utils.abdm_request',
									args: {
										'payload': {
											'authMethod': 'MOBILE_OTP',
											'txnId': txn_id
										},
										'url_key': 'resend_mobile_otp',
										'req_type': 'Health ID'
									},
									callback: function (r) {
										if (r.message == true) {
											frappe.show_alert({
												message:__('OTP resend successfull'),
												indicator:'green'
											}, 5);
										}
									}
								})
							}
							dialog.show();
						}
					}
				});
			}
			d.hide();
		}
	});
	d.show();
}