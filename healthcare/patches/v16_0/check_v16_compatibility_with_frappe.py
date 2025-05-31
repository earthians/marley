import click

import frappe

import healthcare


def execute():
	def major_version(v: str) -> str:
		return v.split(".")[0]

	frappe_version = major_version(frappe.__version__)
	healthcare_version = major_version(healthcare.__version__)

	WIKI_URL = "https://github.com/earthians/marley/wiki/Changes-to-branching-and-versioning"

	if frappe_version == "15" and healthcare_version == "16":
		message = f"""
			The `develop` branch of Marley Health is no longer compatible with Frappe & ERPNext's `version-15`.
			Since you are using ERPNext/Frappe `version-15` please switch Marley Health app's branch to `version-15` and then proceed with the update.\n\t
			You can switch the branch by following the steps mentioned here: {WIKI_URL}
		"""
		click.secho(message, fg="red")

		frappe.throw(message)  # nosemgrep
