from frappe import _


def get_data():
	return [
		{
			"module_name": "Healthcare",
			"color": "grey",
			"icon": "octicon octicon-file-directory",
			"type": "module",
			"label": _("Healthcare"),
			"items": [
				{
					"type": "page",
					"name": "scheduler",
					"label": _("Scheduler"),
					"icon": "octicon octicon-calendar"
				}
			]
		}
	]
