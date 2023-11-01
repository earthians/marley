import click

import frappe


def execute():
	frappe_v = frappe.get_attr("frappe" + ".__version__")
	healthcare_v = frappe.get_attr("healthcare" + ".__version__")

	WIKI_URL = "https://github.com/frappe/health/wiki/changes-to-branching-and-versioning"

	if frappe_v.startswith("14") and healthcare_v.startswith("15"):
		message = f"""
			The `develop` branch of Frappe Health is no longer compatible with Frappe & ERPNext's `version-14`.
			Since you are using ERPNext/Frappe `version-14` please switch Frappe Health app's branch to `version-14` and then proceed with the update.\n\t
			You can switch the branch by following the steps mentioned here: {WIKI_URL}
		"""
		click.secho(message, fg="red")

		frappe.throw(message)  # nosemgrep
