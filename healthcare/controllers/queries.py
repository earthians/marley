import frappe


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_healthcare_service_units(doctype, txt, searchfield, start, page_len, filters):
	query = """
		select name
		from `tabHealthcare Service Unit`
		where
			is_group = 0
			and company = {company}
			and name like {txt}""".format(
				company = frappe.db.escape(filters.get('company')), txt = frappe.db.escape('%{0}%'.format(txt)))

	if filters and filters.get('inpatient_record'):
		from healthcare.healthcare.doctype.inpatient_medication_entry.inpatient_medication_entry import (
			get_current_healthcare_service_unit,
		)
		service_unit = get_current_healthcare_service_unit(filters.get('inpatient_record'))

		# if the patient is admitted, then appointments should be allowed against the admission service unit,
		# inspite of it being an Inpatient Occupancy service unit
		if service_unit:
			query += " and (allow_appointments = 1 or name = {service_unit})".format(service_unit = frappe.db.escape(service_unit))
		else:
			query += " and allow_appointments = 1"
	else:
		query += " and allow_appointments = 1"

	return frappe.db.sql(query, filters)

