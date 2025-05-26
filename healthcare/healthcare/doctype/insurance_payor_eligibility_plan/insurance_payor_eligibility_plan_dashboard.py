from __future__ import unicode_literals

from frappe import _


def get_data():
	return {
		"fieldname": "insurance_plan",
		"transactions": [
			{"label": _("Eligibility"), "items": ["Item Insurance Eligibility"]},
			{"label": _("Insurance Policies"), "items": ["Patient Insurance Policy"]},
			{"label": _("Transactions"), "items": ["Patient Insurance Coverage"]},
		],
	}
