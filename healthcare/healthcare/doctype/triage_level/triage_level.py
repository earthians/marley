# Copyright (c) 2026, earthians and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from healthcare.emergency.dashboard_chart_source.ed_arrivals_by_triage_level.ed_arrivals_by_triage_level import (
	sync_colours,
)


class TriageLevel(Document):
	_DOCTYPE_NAME = "Triage Level"

	def on_update(self):
		sync_colours()

	def after_delete(self):
		sync_colours()

	def after_rename(self, old, new, merge=False):
		sync_colours()
