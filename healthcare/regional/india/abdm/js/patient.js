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
			},
			{
				label: '',
				fieldname: '',
				fieldtype: 'Column Break'
			},
			{
				label: '',
				fieldname: 'suffix',
				fieldtype: 'Data',
				read_only: 1,
				default: '@sbx'
			},
		],
		primary_action_label: 'Get',
		primary_action(values) {
			frappe.call({
				method: 'healthcare.regional.india.abdm.utils.abdm_request',
				args: {
					'payload': {
						'healthId': d.get_value('healthid') + d.get_value('suffix')
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
		fields: [{
			label: 'Aadhaar',
			fieldname: 'aadhaar',
			fieldtype: 'Data'
		},],
		primary_action_label: 'Send OTP',
		primary_action(values) {
			if (d.get_value('aadhaar')) {
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
						if (r.message['txnId']) {
							let dialog = new frappe.ui.Dialog({
								title: 'OTP',
								fields: [{
									label: 'OTP',
									fieldname: 'otp',
									fieldtype: 'Data'
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
									label: '',
									fieldname: '',
									fieldtype: 'Column Break'
								},
								{
									label: '',
									fieldname: 'suffix',
									fieldtype: 'Data',
									read_only: 1,
									default: '@sbx'
								},
								{
									label: '',
									fieldname: 'sb2',
									fieldtype: 'Section Break',
									hide_border: 1
								},
								{
									label: 'Verify User Name',
									fieldname: 'verify_user_name',
									fieldtype: 'Button'
								},
								{
									label: 'Password',
									fieldname: 'password',
									fieldtype: 'Data'
								},
								{
									label: 'Create HealthID',
									fieldname: 'create_healthid',
									fieldtype: 'Button'
								},
								],
								primary_action_label: 'Close',
								primary_action(values) {
									dialog.hide();
								}
							});

							dialog.fields_dict.create_healthid.input.onclick = function () {
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
									callback: function (data) {
										dialog.hide();
										if (data.message['healthIdNumber']) {
											frm.set_value('phr_address', data.message[0])
											frm.set_value('abha_number', data.message[1])
											frappe.show_alert({ message: __('ABHA ID created successfully'), indicator: 'green' }, 5);
											frm.save()
										} else {
											frappe.throw({ message: __("ABHA ID not Created"), title: __("Not Created") });
										}
									}
								});
							}
							dialog.fields_dict.verify_user_name.input.onclick = function () {
								frappe.call({
									method: 'healthcare.regional.india.abdm.utils.abdm_request',
									args: {
										'payload': {
											"healthId": dialog.get_value('username') + dialog.get_value('suffix')
										},
										'url_key': 'exists_by_health_id',
										'req_type': 'Health ID'
									},
									callback: function (data) {
										if (data.message['status'] == false) {
											frappe.show_alert({ message: __('ABHA ID is unique'), indicator: 'green' }, 5);
										}
										else if (data.message['status'] == true) {
											frappe.show_alert({ message: __('ABHA ID already existing'), indicator: 'red' }, 5);
										}

									}
								});
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