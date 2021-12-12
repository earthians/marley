from __future__ import unicode_literals

data = {
	'desktop_icons': [
		'Patient',
		'Patient Appointment',
		'Patient Encounter',
		'Lab Test',
		'Healthcare',
		'Vital Signs',
		'Clinical Procedure',
		'Inpatient Record',
		'Accounts',
		'Buying',
		'Stock',
		'HR',
		'ToDo'
	],
	'default_portal_role': 'Patient',
	'restricted_roles': [
		'Healthcare Administrator',
		'LabTest Approver',
		'Laboratory User',
		'Nursing User',
		'Physician',
		'Patient'
	],
	'custom_fields': {
		'Sales Invoice': [
			{
				'fieldname': 'patient', 'label': 'Patient', 'fieldtype': 'Link', 'options': 'Patient',
				'insert_after': 'naming_series'
			},
			{
				'fieldname': 'patient_name', 'label': 'Patient Name', 'fieldtype': 'Data', 'fetch_from': 'patient.patient_name',
				'insert_after': 'patient', 'read_only': True
			},
			{
				'fieldname': 'ref_practitioner', 'label': 'Referring Practitioner', 'fieldtype': 'Link', 'options': 'Healthcare Practitioner',
				'insert_after': 'customer'
			},
			{
				'fieldname': 'total_insurance_coverage_amount', 'label': 'Total Insurance Coverage Amount', 'fieldtype': 'Currency',
				'insert_after': 'total', 'read_only': True, 'no_copy': True
			},
			{
				'fieldname': 'patient_payable_amount', 'label': 'Patient Payable Amount', 'fieldtype': 'Currency',
				'insert_after': 'total_insurance_coverage_amount', 'read_only': True, 'no_copy': True
			}
		],
		'Sales Invoice Item': [
			{
				'fieldname': 'reference_dt', 'label': 'Reference DocType', 'fieldtype': 'Link', 'options': 'DocType',
				'insert_after': 'edit_references'
			},
			{
				'fieldname': 'reference_dn', 'label': 'Reference Name', 'fieldtype': 'Dynamic Link', 'options': 'reference_dt',
				'insert_after': 'reference_dt'
			},
			{
				'fieldname': 'healthcare_insurance_section', 'fieldtype': 'Section Break',
				'insert_after': 'is_free_item'
			},
			{
				'fieldname': 'coverage_rate', 'label': 'Insurance Coverage Approved Rate', 'fieldtype': 'Currency',
				'insert_after': 'healthcare_insurance_section', 'read_only': True, 'no_copy': True
			},
			{
				'fieldname': 'coverage_qty', 'label': 'Insurance Coverage Approved Qty', 'fieldtype': 'Float',
				'insert_after': 'coverage_rate', 'read_only': True, 'no_copy': True
			},
			{
				'fieldname': 'coverage_percentage', 'label': 'Insurance Coverage %', 'fieldtype': 'Percent',
				'insert_after': 'coverage_qty', 'read_only': True, 'no_copy': True
			},
			{
				'fieldname': 'insurance_coverage_amount', 'label': 'Insurance Coverage Amount', 'fieldtype': 'Currency',
				'insert_after': 'coverage_percentage', 'read_only': True, 'no_copy': True
			},
			{
				'fieldname': 'healthcare_insurance_col_break', 'fieldtype': 'Column Break',
				'insert_after': 'insurance_coverage_amount'
			},
			{
				'fieldname': 'patient_insurance_policy', 'label': 'Patient Insurance Policy Number', 'fieldtype': 'Data',
				'read_only': True, 'insert_after': 'healthcare_insurance_col_break'
			},
			{
				'fieldname': 'insurance_coverage', 'label': 'Patient Insurance Coverage', 'fieldtype': 'Link',
				'read_only': True, 'insert_after': 'patient_insurance_policy', 'options': 'Patient Insurance Coverage', 'no_copy': True
			},
			{
				'fieldname': 'insurance_payor', 'label': 'Insurance Payor', 'fieldtype': 'Link',
				'read_only': True, 'insert_after': 'insurance_coverage', 'options': 'Insurance Payor', 'no_copy': True
			}
		],
		'Stock Entry': [
			{
				'fieldname': 'inpatient_medication_entry', 'label': 'Inpatient Medication Entry', 'fieldtype': 'Link', 'options': 'Inpatient Medication Entry',
				'insert_after': 'credit_note', 'read_only': True
			}
		],
		'Stock Entry Detail': [
			{
				'fieldname': 'patient', 'label': 'Patient', 'fieldtype': 'Link', 'options': 'Patient',
				'insert_after': 'po_detail', 'read_only': True
			},
			{
				'fieldname': 'inpatient_medication_entry_child', 'label': 'Inpatient Medication Entry Child', 'fieldtype': 'Data',
				'insert_after': 'patient', 'read_only': True
			}
		],
		'Journal Entry': [
			{
				'fieldname': 'insurance_coverage', 'label': 'For Insurance Coverage', 'fieldtype': 'Link', 'options': 'Patient Insurance Coverage',
				'insert_after': 'due_date', 'read_only': True, 'no_copy': True
			}
		],
		'Payment Entry Reference': [
			{
				'fieldname': 'insurance_claim', 'label': 'Insurance Claim', 'fieldtype': 'Link', 'options': 'Insurance Claim',
				'insert_after': 'reference_name', 'read_only': True, 'no_copy': True
			},
			{
				'fieldname': 'insurance_claim_coverage', 'label': 'Insurance Claim Coverage', 'fieldtype': 'Link', 'options': 'Insurance Claim Coverage',
				'insert_after': 'insurance_claim', 'read_only': True, 'no_copy': True
			}
		]
	},
	'on_setup': 'healthcare.healthcare.setup.setup_healthcare'
}