# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import json

import frappe
from frappe.desk.doctype.dashboard_chart.dashboard_chart import get as get_chart
from frappe.tests.classes.context_managers import freeze_time
from frappe.utils import add_days, add_to_date, now_datetime, today

from healthcare.emergency.dashboard_chart_source.ed_arrivals_by_triage_level import (
	ed_arrivals_by_triage_level as triage_source,
)
from healthcare.tests.factories.encounters import (
	create_emergency_record,
	create_therapy_plan,
	create_therapy_session,
)
from healthcare.tests.utils import TEST_TIME, HealthcareTestSuite

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
THERAPY_CHART = "Therapy Sessions by Type"
THERAPY_TYPE = "Basic Rehab"
TRIAGE_LEVEL = "_Test Triage Blue"
COMPANY = "_Test Company"


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

	@freeze_time(TEST_TIME)
	def test_therapy_sessions_by_type_stops_at_today(self):
		before = self.therapy_sessions_counted()
		plan = create_therapy_plan()
		create_therapy_session("_Test Patient", THERAPY_TYPE, plan.name, start_date=add_days(today(), -1))
		create_therapy_session("_Test Patient", THERAPY_TYPE, plan.name, start_date=add_days(today(), 1))
		self.assertEqual(self.therapy_sessions_counted(), before + 1)

	@freeze_time(TEST_TIME)
	def test_triage_chart_stops_at_now(self):
		before = self.triage_arrivals_counted()
		for hours in (-1, 1):
			arrival = add_to_date(now_datetime(), hours=hours)
			create_emergency_record("_Test Patient", arrival_datetime=arrival, triage_level=TRIAGE_LEVEL)
		self.assertEqual(self.triage_arrivals_counted(), before + 1)

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

	def therapy_sessions_counted(self) -> int:
		with self.set_user("Administrator"):
			data = get_chart(chart_name=THERAPY_CHART, filters=self.desk_filters(THERAPY_CHART), refresh=1)
		counts = dict(zip(data["labels"], data["datasets"][0]["values"], strict=True)) if data else {}
		return counts.get(THERAPY_TYPE, 0)

	def triage_arrivals_counted(self) -> int:
		counts = triage_source.arrivals_by_level({"company": COMPANY})
		return counts.get(TRIAGE_LEVEL, 0)

	def desk_filters(self, chart: str) -> list:
		static, dynamic = frappe.db.get_value(
			"Dashboard Chart", chart, ["filters_json", "dynamic_filters_json"]
		)
		desk_values = {
			"frappe.datetime.get_today()": today(),
			"frappe.datetime.add_days(frappe.datetime.get_today(), -30)": add_days(today(), -30),
			'frappe.defaults.get_user_default("Company")': COMPANY,
		}
		resolved = [[*row[:3], desk_values[row[3]]] for row in json.loads(dynamic)]
		return json.loads(static) + resolved

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
