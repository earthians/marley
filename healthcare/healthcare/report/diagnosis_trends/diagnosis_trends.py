import frappe
from frappe import _, msgprint


def execute(filters=None):
	if not filters:
		filters = {}

	columns = get_columns()

	diagnosis = get_diagnosis_data(filters)

	if not diagnosis:
		msgprint(_('No records found'))
		return columns, diagnosis

	data = diagnosis
	print(data)

	chart = get_chart_data(data)
	report_summary = get_report_summary(data)
	return columns, data, None, chart, report_summary



def get_report_summary(data):
	return


def get_chart_data(data):
	labels = {item['diagnosis'] for item in data}
	chart = {
		'data': {
			'labels': labels,
			'datasets': []
		},
		'type': 'line',
		# 'height': 300,
	}
	return chart


def get_diagnosis_data(filters):
	data = frappe.get_all('Patient Encounter Diagnosis', fields=['diagnosis', 'creation'])
	return data


def get_columns():
	return


def get_columns():
	return [
		{
			'fieldname': 'diagnosis',
			'label': _('diagnosis'),
			'fieldtype': 'Link',
			'options': 'diagnosis',
			'width': '120'
		},
		{
			'fieldname': 'count',
			'label': _('count'),
			'fieldtype': 'data',
			'width': '120'
		},
	]
