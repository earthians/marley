import frappe


def execute():
	items_to_remove = ["/personal-details", "/lab-test", "/prescription", "/patient-appointments"]

	portal_settings = frappe.get_single("Portal Settings")

	for item in portal_settings.menu:
		if item.route in items_to_remove:
			portal_settings.remove(item)

	portal_settings.add_item(
		{
			"title": "Patient Portal",
			"route": "/patient-portal",
			"reference_doctype": "Patient",
			"role": "Patient",
		}
	)
	portal_settings.save()
