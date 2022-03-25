frappe.ui.form.on('Patient', {
	refresh: function (frm) {
		if (frappe.boot.sysdefaults.country == 'India') {
			unhide_field(['abha_number', 'phr_address']);
			if (!frm.doc.phr_address) {
				frm.add_custom_button(__('Verify ABHA Number'), function () {
					verify_health_id(frm)
				});
			}
			if (!frm.doc.abha_number) {
				frm.add_custom_button(__('Create ABHA'), function () {
					create_abha(frm)
				}).addClass("btn-primary");
			}
		} else {
			hide_field(['abha_number', 'phr_address']);
		}
	}
});

let verify_health_id = function (frm) {
	let d = new frappe.ui.Dialog({
		title: 'Verify ABHA Number',
		fields: [
			{
				label: 'ABHA Number',
				fieldname: 'healthid',
				fieldtype: 'Data'
			},
			{
				label: 'Authentication Method',
				fieldname: 'auth_method',
				fieldtype: 'Select',
				options: ['AADHAAR_OTP', 'MOBILE_OTP'],
				default: 'AADHAAR_OTP'
			},
			{
				fieldname: 'qr_data',
				fieldtype: 'HTML'
			},
			{
				fieldname: 'scanned_data',
				fieldtype: 'Small Text',
				hidden: 1
			},
			{
				fieldname: 'response_message',
				fieldtype: 'HTML',
				read_only: 1
			}
		],
		primary_action_label: 'Send OTP',
		primary_action(values) {
			$(d.fields_dict['response_message'].wrapper).empty();
			// authentication initialization
			frappe.call({
				method: 'healthcare.regional.india.abdm.utils.abdm_request',
				args: {
					'payload': {
						"authMethod": d.get_value('auth_method'),
						"healthid": d.get_value('healthid')
					},
					'url_key': 'auth_init',
					'req_type': 'Health ID'
				},
				freeze: true,
				freeze_message: __('Generating OTP...'),
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
								}
							],
							primary_action_label: 'Verify',
							primary_action(values) {
								// sending otp received to call 2 apis and receive health_data
								frappe.call({
									method: 'healthcare.regional.india.abdm.utils.get_health_data',
									args: {
										'otp': dialog.get_value('otp'),
										'txnId': r.message['txnId'],
										'auth_method': d.get_value('auth_method')
									},
									freeze: true,
									freeze_message: __(`<br><br>Verifying OTP... <br>
										<small>Please note, this may take a while</small>`),
									callback: function (r) {
										if (r.message && r.message['healthIdNumber']) {
											d.get_primary_btn().attr('hidden', true);
											set_qr_scanned_data(d, r.message)
											d.set_values({
												'scanned_data': JSON.stringify(r.message)
											});
										} else {
											if (r.message && r.message.details[0]['message']) {
												show_error_message(d, r.message)
											}
											frappe.show_alert({
												message:__('Failed to fetch health Data, Please try again later'),
												indicator:'red'
											}, 10);
										}
									}
								});
								dialog.hide();
							}
						});
						dialog.show();
					} else {
						if (r.message && r.message.message) {
							show_error_message(d, r.message)
						}
						frappe.show_alert({
							message:__('OTP Generation Failed, Please try again later'),
							indicator:'red'
						}, 10);
					}
				}
			});
		},
		secondary_action_label: 'Save',
		secondary_action(values) {
			// save data from qr_scan/api fetch, save to form
			var scanned_data = JSON.parse(d.get_value('scanned_data'));
			set_data_to_form(frm, scanned_data)
			frm.save();
			d.hide();
		}
	});

	// QR scanner field
	setup_qr_scanner(d)


	d.get_secondary_btn().attr('disabled', true);
	d.fields_dict['scanned_data'].df.onchange = () => {
		if (d.get_value('scanned_data')) {
			d.get_secondary_btn().attr('disabled', false);
		}
	}

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
				fieldtype: 'Data',
				default: frm.doc.mobile,
				depends_on: "eval:doc.mode == 'Mobile'",
				mandatory_depends_on: "eval:doc.mode == 'Mobile'"
			},
		],
		primary_action_label: 'Send OTP',
		primary_action(values) {
			// create ABHA with aadhaar
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
										freeze_message: __(`<br><br><br>Creating Health ID <br>
											<small>Please note, this may take a while</small>`),
										callback: function (data) {
											dialog.hide();
											if (data.message['healthIdNumber']) {
												frm.set_value('phr_address', data.message['healthId'])
												frm.set_value('abha_number', data.message['healthIdNumber'])
												frappe.show_alert({
													message: __('ABHA ID created successfully'),
													indicator: 'green' }, 5);
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
			// create ABHA with mobile_no
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
										fieldname: 'first_name',
										fieldtype: 'Data',
										default: frm.doc.patient_name,
										reqd: 1
									},
									{
										label: '',
										fieldname: 'sb_2',
										fieldtype: 'Section Break',
										reqd: 1
									},
									{
										label: 'Gender',
										fieldname: 'gender',
										fieldtype: 'Link',
										options: 'Gender',
										default: frm.doc.sex,
										reqd: 1
									},
									{
										label: '',
										fieldname: 'cb_2',
										fieldtype: 'Column Break',
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
										method: 'healthcare.regional.india.abdm.utils.abdm_request',
										args: {
											'payload': {
												'to_encrypt': dialog.get_value('otp'),
												'txnId': txn_id
											},
											'url_key': 'verify_mobile_otp',
											'req_type': 'Health ID',
											'to_be_enc': 'otp'
										},
										freeze: true,
										freeze_message: __(`<br><br>Verifying OTP... <br>
											<small>Please note, this may take a while</small>`),
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
															"gender": (dialog.get_value('gender') == 'Male') ? 'M' :
																(dialog.get_value('gender') == 'Female') ? 'F' :
																(dialog.get_value('gender') == 'Prefer not to say') ? 'U' : 'O',
															"name": dialog.get_value('first_name'),
															"yearOfBirth": dialog.get_value('yob')
														},
														'url_key': 'create_abha_w_mobile',
														'req_type': 'Health ID',
														'rec_headers': {
															'T-Token': r.message['token']
														}
													},
													freeze: true,
													freeze_message: __('Creating Health ID <br><small>Please note, this may take a while</small>'),
													callback: function (data) {
														dialog.hide();
														if (data.message['healthIdNumber']) {
															frm.set_value('abha_number', data.message['healthIdNumber'])
															frm.set_value('first_name', dialog.get_value('first_name'))
															frm.set_value('sex', dialog.get_value('gender'))
															frm.save()
															frappe.msgprint({
																title: __('ABHA ID created successfully'),
																indicator: 'green',
																message: __('ABHA ID created, Your ABHA Number is ' + data.message['healthIdNumber'] +
																	` To activate account link Aadhaar is mandatory ,
																	please login to https://healthid.ndhm.gov.in/login
																	and Link Aadhaar.\n Thank you..`)
															});
														} else {
															frappe.throw({ message: __("ABHA ID not Created"), title: __("Not Created") });
														}
													}
												});
											}
										}
									});
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

// to create html table
let set_qr_scanned_data = function(d, scanned_data) {
	let wrapper = $(d.fields_dict['qr_data'].wrapper).empty();
	let qr_table = $(`<table class="table table-bordered" style="cursor:pointer; margin:0px;">
		<tbody></tbody</table>`).appendTo(wrapper);
		const row =
			$(`<tr>
				<td>Name</td>
				<td>${scanned_data['name']}</td>
			</tr>
			<tr>
				<td>Gender</td>
				<td>${scanned_data['gender'] || '-'}</td>
			</tr>
			<tr>
				<td>Mobile</td>
				<td>${scanned_data['mobile'] ||  '-'}</td>
			</tr>
			<tr>
				<td>DOB</td>
				<td>${scanned_data['dayOfBirth'] || '-'}/
					${scanned_data['monthOfBirth'] || '-'}/
					${scanned_data['yearOfBirth'] || '-'}</td>
			</tr>
			<tr>
				<td>Health Id</td>
				<td>${scanned_data['healthId'] || scanned_data['hid'] || '-'}</td>
			</tr>`);
			qr_table.find('tbody').append(row);
}

let set_data_to_form = function(frm, scanned_data) {
	var dob = `${scanned_data['dayOfBirth'] ? scanned_data['dayOfBirth'] : '01'}-
				${scanned_data['monthOfBirth'] ? scanned_data['monthOfBirth'] : '01'}-
				${scanned_data['yearOfBirth']}`
	for (var k in scanned_data) {
		if (k == 'hid' || k == 'healthId'){frm.set_value('phr_address', scanned_data[k])}
		if (k == 'hidn' || k == 'healthIdNumber'){frm.set_value('abha_number', scanned_data[k])}
		if (k == 'name'){frm.set_value('first_name', scanned_data[k])}
		if (dob){frm.set_value('dob', moment(dob, 'DD/MM/YYYY').format('YYYY-MM-DD'))}
		if (k == 'email'){frm.set_value('email', scanned_data[k])}
		if (k == 'mobile'){frm.set_value('mobile', scanned_data[k])}
		if (k == 'gender'){
			let gender = scanned_data[k] == 'M' ? 'Male' :
			scanned_data[k] == 'F' ? 'Female' :
			scanned_data[k] == 'U' ? 'Prefer not to say' : 'Other'
			frm.set_value('sex', gender)}
	}
}

let show_error_message = function(d, message) {
	let wrapper = $(d.fields_dict['response_message'].wrapper).empty();
	$(`<div style="color:red; background-color:#f4f5f6; border-radius:5px;
		padding:5px 5px 5px 5px">${message.message}<br>
		Details: ${message.details[0]['message']}</div>`).appendTo(wrapper);
}

let setup_qr_scanner = function(dialog) {
	dialog.fields_dict.healthid.$wrapper.find('.control-input').append(
		`<span class="link-btn" style="display:inline">
			<a class="btn-open no-decoration" title="${__("Scan")}">
				${frappe.utils.icon('scan', 'sm')}
			</a>
		</span>`
	);
	let scan_btn = dialog.$body.find('.link-btn');
	scan_btn.toggle(true);

	scan_btn.on('click', 'a', () => {
		new frappe.ui.Scanner({
			dialog: true,
			multiple: false,
			on_scan(data) {
				if (data && data.result && data.result.text) {
					var scanned_data = JSON.parse(data.decodedText);
					dialog.set_values({
						'scanned_data': data.decodedText,
						'healthid': (scanned_data['hidn'] ? scanned_data['hidn'] : '')
					});
					set_qr_scanned_data(dialog, scanned_data)
				}
			}
		});
	});
}