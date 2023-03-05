import click
import frappe

from healthcare.setup import before_uninstall as remove_customizations


def before_uninstall():
	try:
		print("Removing customizations created by Frappe Health...")
		remove_customizations()

	except Exception as e:
		BUG_REPORT_URL = "https://github.com/frappe/health/issues/new"
		click.secho(
			"Removing Customizations for Frappe Health failed due to an error."
			" Please try again or"
			f" report the issue on {BUG_REPORT_URL} if not resolved.",
			fg="bright_red",
		)
		raise e

	click.secho("Frappe Health app customizations have been removed successfully...", fg="green")


def after_uninstall():
	print("Reset Portal Settings...")
	frappe.get_doc("Portal Settings", "Portal Settings").reset()
