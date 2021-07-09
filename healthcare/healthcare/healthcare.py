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
				'fieldname': 'total_insurance_claim_amount', 'label': 'Total Insurance Claim Amount', 'fieldtype': 'Currency',
				'insert_after': 'total', 'read_only': True
			},
			{
				'fieldname': 'patient_payable_amount', 'label': 'Patient Payable Amount', 'fieldtype': 'Currency',
				'insert_after': 'total_insurance_claim_amount', 'read_only': True,
				'depends_on':'eval: doc.total_insurance_claim_amount'
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
				'insert_after': 'is_free_item', 'depends_on':'eval: doc.insurance_claim'
			},
			{
				'fieldname': 'insurance_claim_coverage', 'label': 'Healthcare Insurance Claim Coverage', 'fieldtype': 'Percent',
				'insert_after': 'healthcare_insurance_section', 'read_only': True
			},
			{
				'fieldname': 'insurance_claim_amount', 'label': 'Healthcare Insurance Claim Amount', 'fieldtype': 'Currency',
				'insert_after': 'insurance_claim_coverage', 'read_only': True
			},
			{
				'fieldname': 'claim_qty', 'label': 'Healthcare Insurance Claim Approved Qty', 'fieldtype': 'Float',
				'insert_after': 'insurance_claim_amount', 'read_only': True
			},
			{
				'fieldname': 'healthcare_insurance_col_break', 'fieldtype': 'Column Break',
				'insert_after': 'claim_qty'
			},
			{
				'fieldname': 'patient_insurance_policy', 'label': 'Patient Insurance Policy Number', 'fieldtype': 'Data',
				'read_only': True, 'insert_after': 'healthcare_insurance_col_break'
			},
			{
				'fieldname': 'insurance_claim', 'label': 'Healthcare Insurance Claim', 'fieldtype': 'Link',
				'read_only': True, 'insert_after': 'patient_insurance_policy', 'options': 'Healthcare Insurance Claim'
			},
			{
				'fieldname': 'insurance_company', 'label': 'Healthcare Insurance Company', 'fieldtype': 'Link',
				'read_only': True, 'insert_after': 'insurance_claim', 'options': 'Healthcare Insurance Company'
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
		]
	},
	'on_setup': 'healthcare.healthcare.setup.setup_healthcare'
}