# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe import _


def get_data():
	return {
		"fieldname": "ot_booking",
		"transactions": [{"label": _("Clinical Work"), "items": ["Clinical Procedure"]}],
	}
