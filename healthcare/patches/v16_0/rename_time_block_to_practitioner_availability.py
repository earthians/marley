import frappe
from frappe.model.utils.rename_field import rename_field

def execute():
	if frappe.db.exists("DocType", "Time Block") and not frappe.db.exists("DocType", "Practitioner Availability"):
		try:
			frappe.rename_doc("DocType", "Time Block", "Practitioner Availability", force=True)
		except Exception as e:
			frappe.log_error(title="Error renaming DocType to Time Block Practitioner Availability")

		# rename fields
		frappe.reload_doc("healthcare", "doctype", "Practitioner Availability")
		rename_field("Practitioner Availability", "block_date", "start_date")
		rename_field("Practitioner Availability", "block_start_time", "start_time")
		rename_field("Practitioner Availability", "block_end_time", "end_time")
		rename_field("Practitioner Availability", "block_duration", "duration")
		rename_field("Practitioner Availability", "block_type", "type")

		for pa in frappe.get_all("Practitioner Availability"):
			doc = frappe.get_doc("Practitioner Availability", pa.name)
			doc.db_set({
				"end_date": doc.start_date,
				"type": "Unavailable",
			})
