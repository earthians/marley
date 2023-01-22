frappe.provide('frappe.ui.form');

frappe.ui.form.PatientQuickEntryForm = class PatientQuickEntryForm extends frappe.ui.form.QuickEntryForm {

	constructor(doctype, after_insert, init_callback, doc, force) {
		super(doctype, after_insert, init_callback, doc, force);
		this.skip_redirect_on_error = true;
	}

	render_dialog() {

		// filter fields for quick entry which are not wired in standard_fields
		let custom_fields = this.mandatory.filter(
			field => !this.get_standard_fields().map(field => field.fieldname).includes(field.fieldname)
		);

		this.mandatory = this.get_standard_fields();

		// preserve standard_fields order, splice custom fields after Patient name fields
		this.mandatory.splice(3, 0, ...custom_fields);

		super.render_dialog();
	}

	get_standard_fields() {
		return [
			{
				label: __('First Name'),
				fieldname: 'first_name',
				fieldtype: 'Data'
			},
			{
				label: __('Middle Name'),
				fieldname: 'middle_name',
				fieldtype: 'Data'
			},
			{
				label: __('last Name'),
				fieldname: 'last_name',
				fieldtype: 'Data'
			},
			{
				fieldtype: 'Section Break',
				collapsible: 0
			},
			{
				label: __('Gender'),
				fieldname: 'sex',
				fieldtype: 'Link',
				options: 'Gender'
			},
			{
				label: __('Blood Group'),
				fieldname: 'blood_group',
				fieldtype: 'Select',
				options: frappe.meta.get_docfield('Patient', 'blood_group').options
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('Birth Date'),
				fieldname: 'dob',
				fieldtype: 'Date'
			},
			{
				label: __('Identification Number (UID)'),
				fieldname: 'uid',
				fieldtype: 'Data'
			},
			{
				fieldtype: 'Section Break',
				label: __('Primary Contact'),
				collapsible: 1
			},
			{
				label: __('Email Id'),
				fieldname: 'email',
				fieldtype: 'Data',
				options: 'Email'
			},
			{
				label: __('Invite as User'),
				fieldname: 'invite_user',
				fieldtype: 'Check'
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('Mobile Number'),
				fieldname: 'mobile',
				fieldtype: 'Data',
				options: 'Phone'
			},
			{
				fieldtype: 'Section Break',
				label: __('Primary Address'),
				collapsible: 1
			},
			{
				label: __('Address Line 1'),
				fieldname: 'address_line1',
				fieldtype: 'Data'
			},
			{
				label: __('Address Line 2'),
				fieldname: 'address_line2',
				fieldtype: 'Data'
			},
			{
				label: __('ZIP Code'),
				fieldname: 'pincode',
				fieldtype: 'Data'
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('City'),
				fieldname: 'city',
				fieldtype: 'Data'
			},
			{
				label: __('State'),
				fieldname: 'state',
				fieldtype: 'Data'
			},
			{
				label: __('Country'),
				fieldname: 'country',
				fieldtype: 'Link',
				options: 'Country'
			}
		];
	}
}