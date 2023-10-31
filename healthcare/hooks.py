from frappe import _

from . import __version__ as app_version  # noqa

app_name = "healthcare"
app_title = "Healthcare"
app_publisher = "healthcare"
app_description = "healthcare"
app_icon = "octicon octicon-file-directory"
app_color = "grey"
app_email = "contact@frappe.io"
app_license = "MIT"
required_apps = ["erpnext"]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/healthcare/css/healthcare.css"
app_include_js = "healthcare.bundle.js"

# include js, css files in header of web template
# web_include_css = "/assets/healthcare/css/healthcare.css"
# web_include_js = "/assets/healthcare/js/healthcare.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "healthcare/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {"Sales Invoice": "public/js/sales_invoice.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
jinja = {
	"methods": [
		"healthcare.healthcare.doctype.diagnostic_report.diagnostic_report.diagnostic_report_print",
		"healthcare.healthcare.utils.generate_barcodes",
	]
}

# Installation
# ------------

# before_install = "healthcare.install.before_install"
after_install = "healthcare.setup.setup_healthcare"

# Uninstallation
# ------------

before_uninstall = "healthcare.uninstall.before_uninstall"
after_uninstall = "healthcare.uninstall.after_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "healthcare.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

override_doctype_class = {
	"Sales Invoice": "healthcare.healthcare.custom_doctype.sales_invoice.HealthcareSalesInvoice",
}

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"*": {
		"on_submit": "healthcare.healthcare.doctype.patient_history_settings.patient_history_settings.create_medical_record",
		"on_cancel": "healthcare.healthcare.doctype.patient_history_settings.patient_history_settings.delete_medical_record",
		"on_update_after_submit": "healthcare.healthcare.doctype.patient_history_settings.patient_history_settings.update_medical_record",
	},
	"Sales Invoice": {
		"on_submit": "healthcare.healthcare.utils.manage_invoice_submit_cancel",
		"on_cancel": "healthcare.healthcare.utils.manage_invoice_submit_cancel",
		"validate": "healthcare.healthcare.utils.manage_invoice_validate",
	},
	"Company": {
		"after_insert": "healthcare.healthcare.utils.create_healthcare_service_unit_tree_root",
		"on_trash": "healthcare.healthcare.utils.company_on_trash",
	},
	"Patient": {
		"after_insert": "healthcare.regional.india.abdm.utils.set_consent_attachment_details"
	},
}

scheduler_events = {
	"all": [
		"healthcare.healthcare.doctype.patient_appointment.patient_appointment.send_appointment_reminder",
	],
	"daily": [
		"healthcare.healthcare.doctype.patient_appointment.patient_appointment.update_appointment_status",
		"healthcare.healthcare.doctype.fee_validity.fee_validity.update_validity_status",
	],
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"healthcare.tasks.all"
# 	],
# 	"daily": [
# 		"healthcare.tasks.daily"
# 	],
# 	"hourly": [
# 		"healthcare.tasks.hourly"
# 	],
# 	"weekly": [
# 		"healthcare.tasks.weekly"
# 	],
# 	"monthly": [
# 		"healthcare.tasks.monthly"
# 	],
# }

# Testing
# -------

before_tests = "healthcare.healthcare.utils.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "healthcare.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "healthcare.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
auto_cancel_exempted_doctypes = [
	"Inpatient Medication Entry",
]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"healthcare.auth.validate"
# ]

global_search_doctypes = {
	"Healthcare": [
		{"doctype": "Patient", "index": 1},
		{"doctype": "Medical Department", "index": 2},
		{"doctype": "Vital Signs", "index": 3},
		{"doctype": "Healthcare Practitioner", "index": 4},
		{"doctype": "Patient Appointment", "index": 5},
		{"doctype": "Healthcare Service Unit", "index": 6},
		{"doctype": "Patient Encounter", "index": 7},
		{"doctype": "Antibiotic", "index": 8},
		{"doctype": "Diagnosis", "index": 9},
		{"doctype": "Lab Test", "index": 10},
		{"doctype": "Clinical Procedure", "index": 11},
		{"doctype": "Inpatient Record", "index": 12},
		{"doctype": "Sample Collection", "index": 13},
		{"doctype": "Patient Medical Record", "index": 14},
		{"doctype": "Appointment Type", "index": 15},
		{"doctype": "Fee Validity", "index": 16},
		{"doctype": "Practitioner Schedule", "index": 17},
		{"doctype": "Dosage Form", "index": 18},
		{"doctype": "Lab Test Sample", "index": 19},
		{"doctype": "Prescription Duration", "index": 20},
		{"doctype": "Prescription Dosage", "index": 21},
		{"doctype": "Sensitivity", "index": 22},
		{"doctype": "Complaint", "index": 23},
		{"doctype": "Medical Code", "index": 24},
	]
}

domains = {
	"Healthcare": "healthcare.setup",
}

# nosemgrep
standard_portal_menu_items = [
	{
		"title": _("Personal Details"),
		"route": "/personal-details",
		"reference_doctype": "Patient",
		"role": "Patient",
	},
	{
		"title": _("Lab Test"),
		"route": "/lab-test",
		"reference_doctype": "Lab Test",
		"role": "Patient",
	},
	{
		"title": _("Prescription"),
		"route": "/prescription",
		"reference_doctype": "Patient Encounter",
		"role": "Patient",
	},
	{
		"title": _("Patient Appointment"),
		"route": "/patient-appointments",
		"reference_doctype": "Patient Appointment",
		"role": "Patient",
	},
]

has_website_permission = {
	"Lab Test": "healthcare.healthcare.web_form.lab_test.lab_test.has_website_permission",
	"Patient Encounter": "healthcare.healthcare.web_form.prescription.prescription.has_website_permission",
	"Patient Appointment": "healthcare.healthcare.web_form.patient_appointments.patient_appointments.has_website_permission",
	"Patient": "healthcare.healthcare.web_form.personal_details.personal_details.has_website_permission",
}

standard_queries = {
	"Healthcare Practitioner": "healthcare.healthcare.doctype.healthcare_practitioner.healthcare_practitioner.get_practitioner_list"
}

treeviews = [
	"Healthcare Service Unit",
]
