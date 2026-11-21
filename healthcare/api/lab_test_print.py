"""Renderer for the "Lab Test Print" print format — Laboratory Report layout.

Results in this install are stored as an HTML table in Lab Test.custom_result
(columns: Panel, Test Code, Result), keyed by sub-template code (e.g. LAB-001-001).
Test name / unit / reference range come from the sub-template (Lab Test Template),
and the Low/Normal/High flag is computed from the result vs the gendered range.

Handles both an individual Lab Test and a full Lab Request. When the Lab Test
belongs to a Service Request, every Lab Test on that request is included — all
groups — each rendered as one group header with its child tests underneath.
Registered as a Jinja method in hooks.py so the print format can call
``render_lab_test_result_report(doc)``.
"""

from __future__ import annotations

import re
from collections import OrderedDict

import frappe
from frappe.utils import cint, format_datetime, formatdate, strip_html


def _esc(value) -> str:
	return frappe.utils.escape_html(str(value)) if value not in (None, "") else ""


def _format_patient_age(value) -> str:
	"""Normalize Lab Test.patient_age for print (legacy imports stored relativedelta).

	Normal docs use ``Patient.get_age()`` → ``55 Year(s) 9 Month(s) 30 Day(s)``.
	Legacy import incorrectly saved ``Patient.age`` (a relativedelta), which prints as
	``relativedelta(years=+55, months=+9, days=+30)``.
	"""
	if value is None or value == "":
		return ""
	# Live relativedelta object (should not persist, but handle if present)
	if hasattr(value, "years") and hasattr(value, "months") and not isinstance(value, (str, bytes)):
		return (
			f'{int(value.years)} Year(s) {int(value.months)} Month(s) '
			f'{int(getattr(value, "days", 0) or 0)} Day(s)'
		)
	text = str(value).strip()
	if not text or "relativedelta" not in text.lower():
		return text
	# Flatten whitespace so years/months/days can span lines
	flat = re.sub(r"\s+", " ", text)
	years = months = days = 0
	m = re.search(r"years=\+?(-?\d+)", flat, flags=re.I)
	if m:
		years = int(m.group(1))
	m = re.search(r"months=\+?(-?\d+)", flat, flags=re.I)
	if m:
		months = int(m.group(1))
	m = re.search(r"days=\+?(-?\d+)", flat, flags=re.I)
	if m:
		days = int(m.group(1))
	if not any((years, months, days)) and "relativedelta" in flat.lower():
		return ""
	return f"{years} Year(s) {months} Month(s) {days} Day(s)"


def _resolve_group_lab_tests(doc):
	"""All Lab Tests on the Service Request (full request report), else just this doc.

	Multi-group Lab Requests print every panel on the request. Layout still groups
	children under each ``lab_test_group`` / template header.
	"""
	service_request = doc.get("service_request")
	if service_request:
		names = frappe.get_all(
			"Lab Test",
			filters={"service_request": service_request, "docstatus": ["<", 2]},
			order_by="creation asc",
			pluck="name",
		)
		if names:
			return [frappe.get_doc("Lab Test", n) for n in names]
	return [doc]


def _parse_custom_result(html: str):
	"""Parse the custom_result HTML table into [(test_code, result_value), ...]."""
	if not html:
		return []
	rows = []
	try:
		from bs4 import BeautifulSoup

		soup = BeautifulSoup(html, "html.parser")
		body = soup.find("tbody") or soup
		for tr in body.find_all("tr"):
			cells = [td.get_text(strip=True) for td in tr.find_all("td")]
			if len(cells) >= 3:
				rows.append((cells[1], cells[2]))  # (Test Code, Result)
			elif len(cells) == 2:
				rows.append((cells[0], cells[1]))
	except Exception:
		# Fallback: crude regex over <td> cells, three per row.
		cells = re.findall(r"<td[^>]*>(.*?)</td>", html, flags=re.I | re.S)
		cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
		for i in range(0, len(cells) - 2, 3):
			rows.append((cells[i + 1], cells[i + 2]))
	return rows


_TEMPLATE_FIELDS = (
	"lab_test_name",
	"lab_test_uom",
	"male_min_range",
	"male_max_range",
	"female_min_range",
	"female_max_range",
	"min_range",
	"max_range",
)


def _template_info(code: str, cache: dict):
	if code not in cache:
		cache[code] = frappe.db.get_value("Lab Test Template", code, _TEMPLATE_FIELDS, as_dict=True) or {}
	return cache[code]


def _range_bounds(tpl: dict, sex: str):
	"""Pick the applicable (min, max) for the patient's sex, falling back to generic ranges."""
	sex = (sex or "").strip().lower()
	if sex == "female" and (
		tpl.get("female_min_range") not in (None, "") or tpl.get("female_max_range") not in (None, "")
	):
		return tpl.get("female_min_range"), tpl.get("female_max_range")
	if sex == "male" and (
		tpl.get("male_min_range") not in (None, "") or tpl.get("male_max_range") not in (None, "")
	):
		return tpl.get("male_min_range"), tpl.get("male_max_range")
	lo = tpl.get("male_min_range") if tpl.get("male_min_range") not in (None, "") else tpl.get("min_range")
	hi = tpl.get("male_max_range") if tpl.get("male_max_range") not in (None, "") else tpl.get("max_range")
	return lo, hi


def _parse_num(value):
	"""Parse min/max/result numbers; tolerate commas (e.g. ``1,100``) and blanks."""
	if value in (None, ""):
		return None
	try:
		s = str(value).strip().replace(",", "")
		if not s:
			return None
		return float(s)
	except (TypeError, ValueError):
		return None


def _format_num(value) -> str:
	"""Display a numeric range bound without trailing ``.0`` when whole."""
	num = _parse_num(value)
	if num is None:
		return "" if value in (None, "") else str(value).strip()
	if num == int(num):
		return str(int(num))
	return str(num)


def _flag(result: str, lo, hi) -> str:
	val = _parse_num(result)
	if val is None:
		return ""
	lo_n = _parse_num(lo)
	hi_n = _parse_num(hi)
	if lo_n is not None and val < lo_n:
		return "Low"
	if hi_n is not None and val > hi_n:
		return "High"
	if lo_n is None and hi_n is None:
		return ""
	return "Normal"


# Status legends stored in Data min/max fields (e.g. Vitamin D) — split for print.
_RANGE_LEGEND_SPLIT = re.compile(
	r"(?=\b(?:Deficiency|Insufficiency|Sufficiency|Toxicity|"
	r"Critically\s+High|Critically\s+Low|Critical|"
	r"High|Low|Normal|Positive|Negative|Borderline)\b)",
	re.IGNORECASE,
)


def _normalize_range_cmp(text: str) -> str:
	"""Compare free-text min/max ignoring whitespace / dash variants."""
	return re.sub(r"\s+", " ", (text or "").replace("–", "-").replace("—", "-")).strip().lower()


def _is_plain_numeric_bound(text: str) -> bool:
	return _parse_num(text) is not None and re.fullmatch(
		r"-?\d+(?:[.,]\d+)?", (text or "").strip().replace(",", "")
	)


def _break_range_legend(text: str) -> str:
	"""Keep existing newlines, or split a one-line status legend into lines."""
	raw = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
	if not raw:
		return ""
	if "\n" in raw:
		return "\n".join(line.strip() for line in raw.split("\n") if line.strip())

	parts = [p.strip(" \t-–—;") for p in _RANGE_LEGEND_SPLIT.split(raw) if p and p.strip()]
	# Only treat as a legend when we actually got multiple labelled bands.
	if len(parts) > 1:
		return "\n".join(parts)
	return raw


def _range_text(lo, hi) -> str:
	"""Reference range for print.

	- Plain numeric pair → ``15 - 100``
	- Same free-text min and max (common for status legends) → show once
	- Status legends → one band per line (Deficiency / Insufficiency / …)
	"""
	lo_s = _format_num(lo)
	hi_s = _format_num(hi)

	if lo_s and hi_s:
		if _normalize_range_cmp(lo_s) == _normalize_range_cmp(hi_s):
			text = lo_s
		elif _is_plain_numeric_bound(lo_s) and _is_plain_numeric_bound(hi_s):
			text = f"{lo_s} - {hi_s}"
		else:
			# Distinct free-text bounds — keep both, each on its own line.
			text = f"{lo_s}\n{hi_s}"
	else:
		text = lo_s or hi_s or ""

	return _break_range_legend(text)


def _range_html(range_text: str) -> str:
	"""Escape range text and honour line breaks in the print HTML cell."""
	formatted = _break_range_legend(range_text)
	if not formatted:
		return ""
	return _esc(formatted).replace("\n", "<br>")


def _patient_meta(doc):
	patient = doc.get("patient")
	file_no = id_number = ""
	if patient:
		row = frappe.db.get_value("Patient", patient, ["file_no", "id_number"], as_dict=True) or {}
		file_no = row.get("file_no") or ""
		id_number = row.get("id_number") or ""
	user_name = doc.get("lab_technician_name") or ""
	if not user_name:
		user_name = frappe.db.get_value("User", doc.get("owner"), "full_name") or doc.get("owner") or ""
	sex_age = " / ".join(
		[p for p in [doc.get("patient_sex") or "", _format_patient_age(doc.get("patient_age"))] if p]
	)
	referred_doctor = doc.get("practitioner_name") or doc.get("practitioner") or ""
	if not referred_doctor and doc.get("doc_no"):
		from healthcare.api.lab_test import _resolve_practitioner_from_doc_no

		_, pract_name = _resolve_practitioner_from_doc_no(doc.get("doc_no"))
		referred_doctor = pract_name or str(doc.get("doc_no") or "").strip()
	return {
		"patient_name": doc.get("patient_name") or patient or "",
		"file_no": file_no,
		"id_number": id_number,
		"sex_age": sex_age,
		"referred_doctor": referred_doctor,
		"request_no": doc.get("service_request") or doc.name,
		"date": formatdate(doc.get("result_date") or doc.get("submitted_date") or doc.get("creation")),
		"visit_no": doc.get("patient_visit") or "",
		"ip_case_no": doc.get("inpatient_admission") or doc.get("inpatient_record") or "",
		"user": user_name,
	}


# Maroon / navy — inline so print/PDF does not strip class-only colors.
_LR_MAROON = "#800000"
_LR_NAVY = "#000080"
_LR_TH_BG = "#e8eaf0"


def _header_html(doc):
	m = _patient_meta(doc)

	def cell(label, value):
		return (
			f'<td class="lr-lbl" style="width:18%;font-weight:bold;color:{_LR_MAROON} !important;'
			f'border:1px solid #000;padding:4px 6px;vertical-align:top;">{_esc(label)}</td>'
			f'<td class="lr-val" style="width:32%;color:#000;border:1px solid #000;'
			f'padding:4px 6px;vertical-align:top;">{_esc(value)}</td>'
		)

	return f"""
	<table class="lr-info" style="width:100%;border-collapse:collapse;margin-bottom:10px;">
		<tr>{cell("Patient Name:", m["patient_name"])}{cell("Request No.", m["request_no"])}</tr>
		<tr>{cell("Patient File No.", m["file_no"])}{cell("Date:", m["date"])}</tr>
		<tr>{cell("CPR / ID No.", m["id_number"])}{cell("Visit No.", m["visit_no"])}</tr>
		<tr>{cell("Sex / Age", m["sex_age"])}{cell("IP Case No.", m["ip_case_no"])}</tr>
		<tr>{cell("Referred Doctor:", m["referred_doctor"])}{cell("User:", m["user"])}</tr>
	</table>
	"""


def _result_row_html(name, result, uom, flag, range_text) -> str:
	# High = red, Low = orange (portal + print agreement)
	flag_l = (flag or "").strip()
	flag_l_lower = flag_l.lower()
	if "high" in flag_l_lower:
		flag_color, flag_weight = "#dc2626", "bold"  # red
	elif "low" in flag_l_lower:
		flag_color, flag_weight = "#ea580c", "bold"  # orange
	else:
		flag_color, flag_weight = "#000", "normal"
	return (
		f"<tr>"
		f'<td class="lr-tname" style="width:40%;text-align:left;color:#000;'
		f'border:1px solid #000;padding:4px 6px;">{_esc(name)}</td>'
		f'<td class="lr-c" style="text-align:center;color:#000;border:1px solid #000;'
		f'padding:4px 6px;">{_esc(result)}</td>'
		f'<td class="lr-c" style="text-align:center;color:#000;border:1px solid #000;'
		f'padding:4px 6px;">{_esc(uom)}</td>'
		f'<td class="lr-c" style="text-align:center;color:{flag_color};font-weight:{flag_weight};'
		f'border:1px solid #000;padding:4px 6px;">{_esc(flag)}</td>'
		f'<td class="lr-c" style="text-align:left;color:#000;border:1px solid #000;'
		f'padding:4px 6px;line-height:1.35;">{_range_html(range_text)}</td>'
		f"</tr>"
	)


def _rows_from_custom_result(lt, cache) -> list[str]:
	rows = _parse_custom_result(lt.get("custom_result"))
	sex = lt.get("patient_sex")
	body_rows = []
	for code, result in rows:
		tpl = _template_info(code, cache)
		name = tpl.get("lab_test_name") or code
		uom = tpl.get("lab_test_uom") or ""
		lo, hi = _range_bounds(tpl, sex)
		flag = _flag(result, lo, hi) if (result or "").strip() else ""
		body_rows.append(_result_row_html(name, result, uom, flag, _range_text(lo, hi)))
	return body_rows


def _rows_from_normal_items(lt, cache) -> list[str]:
	"""Fallback rows from normal_test_items (even when result_value is blank)."""
	sex = lt.get("patient_sex")
	body_rows = []
	for item in lt.get("normal_test_items") or []:
		code = (getattr(item, "template", None) or "").strip()
		result = getattr(item, "result_value", None) or ""
		name = (
			getattr(item, "lab_test_name", None)
			or getattr(item, "lab_test_event", None)
			or code
		)
		uom = getattr(item, "lab_test_uom", None) or ""
		range_text = getattr(item, "normal_range", None) or ""
		lo = hi = None
		tpl = {}
		if code:
			tpl = _template_info(code, cache)
			if not name:
				name = tpl.get("lab_test_name") or code
			if not uom:
				uom = tpl.get("lab_test_uom") or ""
			lo, hi = _range_bounds(tpl, sex)
			if not range_text:
				range_text = _range_text(lo, hi)
		if lo is None and hi is None:
			parent_code = (lt.get("template") or "").strip()
			if parent_code:
				tpl = _template_info(parent_code, cache)
				lo, hi = _range_bounds(tpl, sex)
				if not range_text:
					range_text = _range_text(lo, hi)
		flag = ""
		# Prefer explicit status band (Vitamin D Deficiency / …) when present.
		status_mark = (getattr(item, "result_status", None) or "").strip()
		if status_mark:
			flag = status_mark
		elif str(result).strip() and (lo not in (None, "") or hi not in (None, "")):
			flag = _flag(result, lo, hi)
		body_rows.append(_result_row_html(name or "—", result, uom, flag, range_text))
	return body_rows


def _rows_from_single_result(lt, cache) -> list[str]:
	"""One row from custom_result / template for a simple (non-table) Lab Test line."""
	code = (lt.get("template") or "").strip()
	result = ""
	raw = (lt.get("custom_result") or "").strip()
	if raw:
		# Plain value (not an HTML table of sub-tests).
		plain = strip_html(raw).strip()
		if plain and not _parse_custom_result(raw):
			result = plain

	if code:
		tpl = _template_info(code, cache)
		name = tpl.get("lab_test_name") or lt.get("lab_test_name") or code
		uom = tpl.get("lab_test_uom") or ""
		lo, hi = _range_bounds(tpl, lt.get("patient_sex"))
		flag = _flag(result, lo, hi) if result else ""
		return [_result_row_html(name, result, uom, flag, _range_text(lo, hi))]

	name = lt.get("lab_test_name") or lt.name
	return [_result_row_html(name, result, "", "", "")]


def _body_rows_for_lab_test(lt, cache) -> list[str]:
	"""Collect result rows for one Lab Test document (sub-units or a single line)."""
	body_rows = _rows_from_custom_result(lt, cache)
	if not body_rows:
		body_rows = _rows_from_normal_items(lt, cache)
	if not body_rows:
		body_rows = _rows_from_single_result(lt, cache)
	return body_rows


def _group_display_name(group_key: str, tests: list) -> str:
	"""Human label for a panel / single: prefer group template name, else first child name."""
	if group_key:
		name = frappe.db.get_value("Lab Test Template", group_key, "lab_test_name")
		if name:
			return name
	first = tests[0] if tests else None
	if first:
		return first.get("lab_test_name") or first.get("template") or first.name
	return group_key or "Lab Test"


def _bucket_key(lt) -> str:
	group = (lt.get("lab_test_group") or "").strip()
	if group:
		return group
	return (lt.get("template") or "").strip() or lt.name


def _section_html_from_rows(group_name: str, body_rows: list[str]) -> str:
	th = (
		f"border:1px solid #000;padding:4px 6px;background:{_LR_TH_BG};"
		f"color:{_LR_NAVY} !important;font-weight:bold;text-align:center;"
	)
	return f"""
	<div class="lr-group" style="font-weight:bold;color:{_LR_MAROON} !important;padding:6px 2px 4px;margin-top:6px;">
		{_esc(group_name)}
	</div>
	<table class="lr-results" style="width:100%;border-collapse:collapse;margin-bottom:10px;">
		<thead>
			<tr>
				<th class="lr-tname" style="{th}width:40%;text-align:left;">Test Name</th>
				<th class="lr-c" style="{th}">Result</th>
				<th class="lr-c" style="{th}">Unit</th>
				<th class="lr-c" style="{th}">Flag</th>
				<th class="lr-c" style="{th}">Normal Range</th>
			</tr>
		</thead>
		<tbody>{''.join(body_rows)}</tbody>
	</table>
	"""


def _sections_html(lab_tests, cache) -> str:
	"""One section per group (or standalone template), with all child tests as rows."""
	buckets: OrderedDict[str, list] = OrderedDict()
	for lt in lab_tests:
		buckets.setdefault(_bucket_key(lt), []).append(lt)

	parts: list[str] = []
	for key, tests in buckets.items():
		body_rows: list[str] = []
		for lt in tests:
			body_rows.extend(_body_rows_for_lab_test(lt, cache))
		if not body_rows:
			body_rows = [_result_row_html("—", "", "", "", "")]
		parts.append(_section_html_from_rows(_group_display_name(key, tests), body_rows))
	return "".join(parts)


def _laboratory_report_shell(doc, sections: str) -> str:
	"""Shared Laboratory Report chrome (header / note / signatures)."""
	note = (doc.get("lab_test_comment") or "").strip()
	return f"""
	<style>
		/* Force colors in browser print + PDF (class CSS alone is often overridden). */
		.lr-report {{ font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12px; }}
		.lr-report .lr-title,
		.lr-report .lr-details,
		.lr-report .lr-group,
		.lr-report .lr-info .lr-lbl,
		.lr-report .lr-note b {{
			color: {_LR_MAROON} !important;
			-webkit-print-color-adjust: exact !important;
			print-color-adjust: exact !important;
		}}
		.lr-report .lr-results th {{
			color: {_LR_NAVY} !important;
			background-color: {_LR_TH_BG} !important;
			-webkit-print-color-adjust: exact !important;
			print-color-adjust: exact !important;
		}}
		@media print {{
			.lr-report .lr-title,
			.lr-report .lr-details,
			.lr-report .lr-group,
			.lr-report .lr-info .lr-lbl,
			.lr-report .lr-note b {{ color: {_LR_MAROON} !important; }}
			.lr-report .lr-results th {{
				color: {_LR_NAVY} !important;
				background-color: {_LR_TH_BG} !important;
			}}
		}}
	</style>
	<div class="lr-report">
		<div class="lr-title" style="text-align:center;font-size:20px;font-weight:bold;color:{_LR_MAROON} !important;margin:4px 0 12px;">
			Laboratory Report
		</div>
		{_header_html(doc)}
		<div class="lr-details" style="text-align:center;font-weight:bold;color:{_LR_MAROON} !important;font-size:14px;margin:10px 0 8px;">
			Test Result Details
		</div>
		{sections}
		<div class="lr-note" style="border:1px solid #000;padding:4px 6px;margin-bottom:24px;min-height:20px;">
			<b style="color:{_LR_MAROON} !important;">Note:</b> {_esc(note)}
		</div>
		<table class="lr-sign" style="width:100%;margin-top:40px;">
			<tr>
				<td style="width:50%;text-align:center;font-size:11px;padding-top:24px;color:#000;">
					<b>{_esc(doc.get('lab_technician_name') or '')}</b><br>LAB TECHNOLOGIST
				</td>
				<td style="width:50%;text-align:center;font-size:11px;padding-top:24px;color:#000;">
					<b>{_esc(doc.get('approved_by_name') or '')}</b><br>LAB Technician
				</td>
			</tr>
		</table>
	</div>
	"""


@frappe.whitelist()
def render_lab_test_result_report(doc):
	"""Jinja method + whitelisted: full body HTML for the Laboratory Report."""
	if isinstance(doc, str):
		doc = frappe.get_doc("Lab Test", doc)

	lab_tests = _resolve_group_lab_tests(doc)
	cache: dict = {}
	sections = _sections_html(lab_tests, cache)
	return _laboratory_report_shell(doc, sections)


def _legacy_lab_test_lines(doc) -> list:
	"""LAB 00-04 child rows for a legacy-imported Lab Test parent."""
	rows = list(doc.get("lab_test_lines") or [])
	if rows:
		return rows
	name = doc.get("name")
	if not name:
		return []
	return frappe.get_all(
		"Lab Test Line",
		filters={"parent": name, "parenttype": "Lab Test"},
		fields=[
			"lab_group_num",
			"group_name",
			"lab_sub_num",
			"lab_result_value",
			"sr_num",
			"idx",
		],
		order_by="sr_num asc, idx asc",
	)


def _legacy_group_label(group_code: str, group_name: str, cache: dict) -> str:
	label = (group_name or "").strip()
	if label:
		return label
	code = (group_code or "").strip()
	if not code:
		return "Lab Test"
	tpl = _template_info(code, cache)
	return tpl.get("lab_test_name") or code


def _sections_html_from_legacy_lines(doc, cache) -> str:
	"""Group ``lab_test_lines`` panels into the same section layout as Lab Test Print."""
	lines = _legacy_lab_test_lines(doc)
	if not lines:
		return _section_html_from_rows(
			doc.get("lab_test_name") or doc.get("template") or doc.name,
			[_result_row_html("—", "", "", "", "")],
		)

	buckets: OrderedDict[str, list] = OrderedDict()
	for line in lines:
		if hasattr(line, "as_dict"):
			line = line.as_dict()
		group_code = (line.get("lab_group_num") or doc.get("template") or doc.name or "").strip()
		buckets.setdefault(group_code, []).append(line)

	sex = doc.get("patient_sex")
	parts: list[str] = []
	for group_code, group_lines in buckets.items():
		body_rows: list[str] = []
		group_name = ""
		for line in group_lines:
			group_name = group_name or (line.get("group_name") or "")
			code = (line.get("lab_sub_num") or "").strip()
			result = (line.get("lab_result_value") or "").strip()
			tpl = _template_info(code, cache) if code else {}
			name = tpl.get("lab_test_name") or code or "—"
			uom = tpl.get("lab_test_uom") or ""
			lo, hi = _range_bounds(tpl, sex) if tpl else (None, None)
			flag = _flag(result, lo, hi) if result else ""
			body_rows.append(_result_row_html(name, result, uom, flag, _range_text(lo, hi)))
		if not body_rows:
			body_rows = [_result_row_html("—", "", "", "", "")]
		parts.append(
			_section_html_from_rows(_legacy_group_label(group_code, group_name, cache), body_rows)
		)
	return "".join(parts)


@frappe.whitelist()
def render_lab_test_legacy_result_report(doc):
	"""Laboratory Report layout for ``is_legacy_import`` Lab Tests (``lab_test_lines``).

	Same look as ``render_lab_test_result_report``, but reads child Lab Test Line rows
	instead of Service Request sibling docs / custom_result tables. Used only by the
	``Lab Test Legacy Print`` format — does not change Lab Test Print.
	"""
	if isinstance(doc, str):
		doc = frappe.get_doc("Lab Test", doc)

	cache: dict = {}
	sections = _sections_html_from_legacy_lines(doc, cache)
	return _laboratory_report_shell(doc, sections)


def _external_meta(doc):
	"""Header fields for the external-lab style report (Al Borg–like layout)."""
	m = _patient_meta(doc)
	company = ""
	cost_center = ""
	sr = (doc.get("service_request") or "").strip()
	if sr and frappe.db.exists("Service Request", sr):
		sr_row = frappe.db.get_value(
			"Service Request", sr, ["company", "cost_center", "creation"], as_dict=True
		) or {}
		company = sr_row.get("company") or ""
		cost_center = sr_row.get("cost_center") or ""
		registered = sr_row.get("creation")
	else:
		registered = doc.get("creation")

	sample_at = cost_center or company or ""
	if cost_center and frappe.db.exists("Cost Center", cost_center):
		sample_at = (
			frappe.db.get_value("Cost Center", cost_center, "cost_center_name") or cost_center
		)

	reported = doc.get("result_date") or doc.get("submitted_date") or doc.get("modified")
	return {
		"patient_name": m["patient_name"],
		"sex_age": m["sex_age"],
		"patient_no": m["file_no"] or m["id_number"] or (doc.get("patient") or ""),
		"sample_collected_at": sample_at,
		"contract": company,
		"file_no": m["file_no"],
		"accession_no": doc.name,
		"registered_on": format_datetime(registered) if registered else "",
		"reported_on": format_datetime(reported) if reported else (m["date"] or ""),
		"request_no": m["request_no"],
	}


def _external_header_html(doc) -> str:
	m = _external_meta(doc)

	def col(label, value):
		return (
			f'<div style="margin-bottom:3px;">'
			f'<span style="font-weight:bold;color:#1a1a1a;">{_esc(label)}</span> '
			f'<span style="color:#000;">{_esc(value)}</span>'
			f"</div>"
		)

	return f"""
	<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px;">
		<tr>
			<td style="width:34%;vertical-align:top;padding-right:8px;">
				{col("Name:", m["patient_name"])}
				{col("Age / Sex:", m["sex_age"])}
				{col("Patient No.:", m["patient_no"])}
			</td>
			<td style="width:33%;vertical-align:top;padding-right:8px;">
				{col("Sample Collected At:", m["sample_collected_at"])}
				{col("Contract:", m["contract"])}
				{col("File No.:", m["file_no"])}
			</td>
			<td style="width:33%;vertical-align:top;">
				{col("Accession No.:", m["accession_no"])}
				{col("Registered on:", m["registered_on"])}
				{col("Reported on:", m["reported_on"])}
			</td>
		</tr>
	</table>
	"""


def _external_result_row_html(name, result, uom, range_text, indent=False, bold=False) -> str:
	"""Test / Result / Unit / Ref. Range — no Flag column."""
	weight = "font-weight:bold;" if bold else ""
	pad = "padding-left:16px;" if indent else ""
	return (
		f"<tr>"
		f'<td style="width:45%;text-align:left;border-bottom:1px solid #ccc;padding:5px 4px;{pad}{weight}">{_esc(name)}</td>'
		f'<td style="text-align:left;border-bottom:1px solid #ccc;padding:5px 4px;{weight}">{_esc(result)}</td>'
		f'<td style="text-align:center;border-bottom:1px solid #ccc;padding:5px 4px;">{_esc(uom)}</td>'
		f'<td style="text-align:left;border-bottom:1px solid #ccc;padding:5px 4px;line-height:1.35;">'
		f"{_range_html(range_text)}</td>"
		f"</tr>"
	)


def _external_collection_header(name: str) -> str:
	"""Bold subgroup title, same role as Direct Smear / Total Nugent Score on the sample report."""
	return (
		"<tr>"
		'<td colspan="4" style="font-weight:bold;text-decoration:underline;text-align:left;'
		'padding:10px 4px 4px;border-bottom:1px solid #333;">'
		f"{_esc(name)}</td></tr>"
	)


def _external_comments_row(content: str) -> str:
	raw = content or ""
	paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", raw, flags=re.I | re.S)
	if paragraphs:
		lines = [strip_html(p).strip() for p in paragraphs]
		lines = [line for line in lines if line]
		text = "<br>".join(_esc(line) for line in lines)
	else:
		text = _esc(strip_html(raw).strip())
	if not text:
		return ""
	return (
		"<tr><td colspan=\"4\" style=\"padding:2px 4px 8px 16px;font-size:10px;"
		"border-bottom:1px solid #eee;line-height:1.35;\">"
		"<div style=\"font-weight:bold;\">Comments</div>"
		f"<div>{text}</div></td></tr>"
	)


def _multiple_result_defs(template: str, cache: dict) -> list[dict]:
	key = f"mr-defs:{(template or '').strip()}"
	if key in cache:
		return cache[key]
	rows = []
	name = (template or "").strip()
	if name and frappe.db.exists("Lab Test Template", name):
		doc = frappe.get_doc("Lab Test Template", name)
		for row in doc.get("multiple_result_type") or []:
			rows.append(
				{
					"test_unit": (getattr(row, "test_unit", None) or "").strip(),
					"uom": (getattr(row, "uom", None) or "").strip(),
					"collection": (getattr(row, "collection_name", None) or "").strip(),
					"male_min_range": getattr(row, "male_min_range", None),
					"male_max_range": getattr(row, "male_max_range", None),
					"female_min_range": getattr(row, "female_min_range", None),
					"female_max_range": getattr(row, "female_max_range", None),
					"min_range": getattr(row, "male_min_range", None),
					"max_range": getattr(row, "male_max_range", None),
					"total_inclusion": cint(getattr(row, "total_inclusion", 0)),
					"total_collection": (getattr(row, "total_inclusion_collection", None) or "").strip(),
					"total": getattr(row, "total", None),
					"instructions": getattr(row, "instructions", None) or "",
				}
			)
	cache[key] = rows
	return rows


def _external_grouped_rows(lt, items, defs) -> list[str]:
	"""Collection headers, then Test / Result / Unit / Ref. Range, then the total line."""
	sex = lt.get("patient_sex")
	saved = {}
	for item in items:
		event = (
			getattr(item, "lab_test_event", None) or getattr(item, "lab_test_name", None) or ""
		).strip()
		if event:
			saved[event] = item

	body: list[str] = []
	specimen = (getattr(lt, "custom_speciment_type", None) or lt.get("custom_speciment_type") or "").strip()
	if specimen:
		body.append(_external_result_row_html("Sample Type :", specimen, "", ""))

	groups: OrderedDict[str, list] = OrderedDict()
	seen_units = set()
	for row in defs:
		if row.get("total_inclusion"):
			continue
		unit = row.get("test_unit") or ""
		if not unit:
			continue
		collection = row.get("collection") or ""
		groups.setdefault(collection, []).append(("def", row))
		seen_units.add(unit)
	for item in items:
		event = (
			getattr(item, "lab_test_event", None) or getattr(item, "lab_test_name", None) or ""
		).strip()
		if event in seen_units:
			continue
		collection = (getattr(item, "collection_name", None) or "").strip()
		groups.setdefault(collection, []).append(("item", item))

	totals_by_collection: dict[str, list] = {}
	for row in defs:
		if not row.get("total_inclusion"):
			continue
		collection = row.get("total_collection") or ""
		totals_by_collection.setdefault(collection, []).append(row)
		groups.setdefault(collection, [])

	for collection, entries in groups.items():
		if collection:
			body.append(_external_collection_header(collection))
		for kind, entry in entries:
			if kind == "def":
				event = entry.get("test_unit") or "—"
				item = saved.get(event)
				result = (getattr(item, "result_value", None) or "") if item else ""
				uom = (
					(getattr(item, "lab_test_uom", None) or "") if item else ""
				).strip() or (entry.get("uom") or "")
				range_text = ((getattr(item, "normal_range", None) or "") if item else "").strip()
				if not range_text:
					lo, hi = _range_bounds(entry, sex)
					range_text = _range_text(lo, hi)
				comment = (getattr(item, "lab_test_comment", None) or "") if item else ""
			else:
				event = (
					getattr(entry, "lab_test_event", None) or getattr(entry, "lab_test_name", None) or "—"
				).strip()
				result = getattr(entry, "result_value", None) or ""
				uom = (getattr(entry, "lab_test_uom", None) or "").strip()
				range_text = (getattr(entry, "normal_range", None) or "").strip()
				comment = getattr(entry, "lab_test_comment", None) or ""
			body.append(
				_external_result_row_html(event or "—", result, uom, range_text, indent=bool(collection))
			)
			if (comment or "").strip():
				body.append(_external_comments_row(comment))
		for row in totals_by_collection.get(collection, []):
			lo, hi = _range_bounds(row, sex)
			body.append(
				_external_result_row_html(
					row.get("test_unit") or "Total",
					_format_num(row.get("total")),
					row.get("uom") or "",
					_range_text(lo, hi),
					indent=bool(collection),
					bold=True,
				)
			)
			if row.get("instructions"):
				body.append(_external_comments_row(row.get("instructions")))
	return body


def _external_rows_for_lab_test(lt, cache) -> list[str]:
	"""External report rows. Grouped collections and totals stay on this format only."""
	items = list(lt.get("normal_test_items") or [])
	defs = _multiple_result_defs(lt.get("template"), cache)
	grouped = any(row.get("total_inclusion") or row.get("collection") for row in defs) or any(
		(getattr(item, "collection_name", None) or "").strip() for item in items
	)
	if grouped and (defs or items):
		return _external_grouped_rows(lt, items, defs)

	rows = _parse_custom_result(lt.get("custom_result"))
	sex = lt.get("patient_sex")
	body = []
	if rows:
		for code, result in rows:
			tpl = _template_info(code, cache)
			name = tpl.get("lab_test_name") or code
			uom = tpl.get("lab_test_uom") or ""
			lo, hi = _range_bounds(tpl, sex)
			body.append(_external_result_row_html(name, result, uom, _range_text(lo, hi)))
		return body

	for item in items:
		code = (getattr(item, "template", None) or "").strip()
		result = getattr(item, "result_value", None) or ""
		name = (
			getattr(item, "lab_test_name", None)
			or getattr(item, "lab_test_event", None)
			or code
		)
		uom = getattr(item, "lab_test_uom", None) or ""
		range_text = getattr(item, "normal_range", None) or ""
		if code:
			tpl = _template_info(code, cache)
			if not name:
				name = tpl.get("lab_test_name") or code
			if not uom:
				uom = tpl.get("lab_test_uom") or ""
			if not range_text:
				lo, hi = _range_bounds(tpl, sex)
				range_text = _range_text(lo, hi)
		body.append(_external_result_row_html(name or "—", result, uom, range_text))
	if body:
		return body

	code = (lt.get("template") or "").strip()
	raw = (lt.get("custom_result") or "").strip()
	result = ""
	if raw:
		plain = strip_html(raw).strip()
		if plain and not _parse_custom_result(raw):
			result = plain
	if code:
		tpl = _template_info(code, cache)
		name = tpl.get("lab_test_name") or lt.get("lab_test_name") or code
		uom = tpl.get("lab_test_uom") or ""
		lo, hi = _range_bounds(tpl, lt.get("patient_sex"))
		return [_external_result_row_html(name, result, uom, _range_text(lo, hi))]
	return [_external_result_row_html(lt.get("lab_test_name") or lt.name, result, "", "")]


def _external_sections_html(lab_tests, cache) -> str:
	buckets: OrderedDict[str, list] = OrderedDict()
	for lt in lab_tests:
		buckets.setdefault(_bucket_key(lt), []).append(lt)

	parts: list[str] = []
	th = "border-bottom:2px solid #333;padding:6px 4px;font-weight:bold;font-size:11px;"
	for key, tests in buckets.items():
		body_rows: list[str] = []
		for lt in tests:
			body_rows.extend(_external_rows_for_lab_test(lt, cache))
		if not body_rows:
			body_rows = [_external_result_row_html("—", "", "", "")]
		title = _group_display_name(key, tests)
		parts.append(
			f"""
			<div style="font-weight:bold;font-size:13px;margin:10px 0 6px;color:#111;">
				{_esc(title)}
			</div>
			<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px;">
				<thead>
					<tr>
						<th style="{th}width:45%;text-align:left;">Test</th>
						<th style="{th}text-align:left;">Result</th>
						<th style="{th}text-align:center;">Unit</th>
						<th style="{th}text-align:center;">Ref. Range</th>
					</tr>
				</thead>
				<tbody>{''.join(body_rows)}</tbody>
			</table>
			"""
		)
	return "".join(parts)


@frappe.whitelist()
def render_lab_test_external_report(doc):
	"""External / outsourced-style lab report: results only, no Comments / Note blocks."""
	if isinstance(doc, str):
		doc = frappe.get_doc("Lab Test", doc)

	lab_tests = _resolve_group_lab_tests(doc)
	cache: dict = {}
	sections = _external_sections_html(lab_tests, cache)

	return f"""
	<style>
		.ex-lab {{ font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11px; }}
		@media print {{
			.ex-lab {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
		}}
	</style>
	<div class="ex-lab">
		{_external_header_html(doc)}
		{sections}
	</div>
	"""


def template_allows_external_lab_print(template_name: str) -> bool:
	"""True when Lab Test Template has Enable External Lab Print checked."""
	name = (template_name or "").strip()
	if not name or not frappe.db.exists("Lab Test Template", name):
		return False
	if not frappe.db.has_column("Lab Test Template", "enable_external_lab_print"):
		return False
	return bool(cint(frappe.db.get_value("Lab Test Template", name, "enable_external_lab_print")))
