# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import json

import frappe
from frappe.desk.doctype.dashboard_chart.dashboard_chart import get as get_chart

from healthcare.emergency.dashboard_chart_source.ed_arrivals_by_triage_level import (
	ed_arrivals_by_triage_level as triage_source,
)
from healthcare.tests.utils import HealthcareTestSuite

WORKSPACE_CHARTS = {
	"Healthcare": ["Daily New Patients", "Encounters by Department"],
	"Outpatient": ["Daily Appointments", "Appointments by Status"],
	"Diagnostics": ["Daily Observations", "Observations by Status"],
	"Emergency": ["Daily ED Arrivals", "ED Arrivals by Triage Level"],
	"Inpatient": ["Daily Admissions", "Inpatients by Status"],
	"Rehabilitation": ["Daily Therapy Sessions", "Therapy Sessions by Type"],
	"Insurance": ["Daily Insurance Claims", "Insurance Claims by Status"],
}
TRIAGE_CHART = "ED Arrivals by Triage Level"


class TestAreaCharts(HealthcareTestSuite):
	def test_each_workspace_shows_its_two_charts(self):
		for workspace, charts in WORKSPACE_CHARTS.items():
			document = frappe.get_doc("Workspace", workspace)
			self.assertEqual([row.chart_name for row in document.charts], charts, workspace)
			self.assertEqual(self.charts_in_layout(document), charts, workspace)

	def test_charts_belong_to_their_workspace_module(self):
		for workspace, charts in WORKSPACE_CHARTS.items():
			module = frappe.db.get_value("Workspace", workspace, "module")
			for chart in charts:
				self.assertEqual(frappe.db.get_value("Dashboard Chart", chart, "module"), module, chart)

	def test_native_charts_load(self):
		with self.set_user("Administrator"):
			for chart in self.native_charts():
				get_chart(chart_name=chart, refresh=1)

	def test_observations_by_status_shows_today(self):
		filters = json.loads(
			frappe.db.get_value("Dashboard Chart", "Observations by Status", "dynamic_filters_json")
		)
		self.assertIn(["Observation", "posting_date", ">=", "frappe.datetime.get_today()"], filters)

	def test_appointments_by_status_stops_at_today(self):
		filters = json.loads(
			frappe.db.get_value("Dashboard Chart", "Appointments by Status", "dynamic_filters_json")
		)
		self.assertIn(
			["Patient Appointment", "appointment_date", "<=", "frappe.datetime.get_today()"], filters
		)

	def test_outpatient_charts_skip_inpatient_appointments(self):
		for chart in WORKSPACE_CHARTS["Outpatient"]:
			filters = json.loads(frappe.db.get_value("Dashboard Chart", chart, "filters_json"))
			self.assertIn(["Patient Appointment", "inpatient_record", "is", "not set"], filters, chart)

	def test_triage_chart_lists_levels_in_priority_order(self):
		with self.set_user("Administrator"):
			data = triage_source.get(chart_name=TRIAGE_CHART, refresh=1)
		levels = [level.name for level in triage_source.ordered_levels()]
		self.assertEqual(data["labels"], [*levels, "Not Triaged"])
		self.assertEqual(len(data["datasets"][0]["values"]), len(levels) + 1)

	def test_triage_chart_needs_emergency_record_access(self):
		with self.set_user("test_user@marleyhealth.io"), self.assertRaises(frappe.PermissionError):
			triage_source.get(chart_name=TRIAGE_CHART, refresh=1)

	def test_saving_a_level_recolours_the_chart(self):
		level = frappe.get_doc("Triage Level", triage_source.ordered_levels()[0].name)
		level.color = "#123456"
		level.save()
		self.assertEqual(self.triage_colours()[0], "#123456")
		self.assertEqual(self.triage_colours()[-1], triage_source.NOT_TRIAGED_COLOUR)

	def test_renaming_a_level_keeps_colours_with_their_level(self):
		frappe.rename_doc("Triage Level", "_Test Triage Amber", "_Test Triage Zinc")
		self.assertEqual(self.colour_of("_Test Triage Zinc"), "#f59e0b")
		self.assertEqual(self.colour_of("_Test Triage Blue"), "#2563eb")

	def test_untriaged_counts_add_up_however_they_are_stored(self):
		rows = [
			frappe._dict(triage_level=None, arrivals=2),
			frappe._dict(triage_level="", arrivals=3),
		]
		self.assertEqual(triage_source.merge_counts(rows), {None: 5})

	def colour_of(self, level: str) -> str:
		names = [row.name for row in triage_source.ordered_levels()]
		return self.triage_colours()[names.index(level)]

	def charts_in_layout(self, workspace) -> list[str]:
		blocks = json.loads(workspace.content)
		return [block["data"]["chart_name"] for block in blocks if block["type"] == "chart"]

	def native_charts(self) -> list[str]:
		charts = [chart for charts in WORKSPACE_CHARTS.values() for chart in charts]
		return [chart for chart in charts if chart != TRIAGE_CHART]

	def triage_colours(self) -> list[str]:
		return json.loads(frappe.db.get_value("Dashboard Chart", TRIAGE_CHART, "custom_options"))["colors"]
