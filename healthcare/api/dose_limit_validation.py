"""Validate medicine doses against Item max-dose fields."""

from __future__ import annotations

import re

import frappe
from frappe.utils import add_to_date, cint, flt, get_datetime, getdate, nowdate, now_datetime


def _healthcare_settings_flag(fieldname: str) -> bool:
	"""Return True when a Healthcare Settings checkbox is enabled.

	Do not use ``frappe.db.has_column`` here — Healthcare Settings is a Single
	DocType and values live in ``tabSingles``, so column checks falsely disable
	validation even when the checkbox is checked.
	"""
	if not fieldname:
		return False
	try:
		return bool(cint(frappe.db.get_single_value("Healthcare Settings", fieldname) or 0))
	except Exception:
		return False


def dose_validation_toggles(context: str) -> dict:
	"""
	Which dose checks to run for a context.

	context:
	  - ``prescription`` → validate_dose_per_*_on_prescription
	  - ``given_medicine`` → validate_dose_per_*_on_given_medicine

	session = per single administration; day = per-day / rolling 24h;
	long_acting_period = rolling Item dosing period for depot / LAI.
	Unchecked → do not validate that limit.
	"""
	ctx = (context or "").strip().lower()
	if ctx in ("prescription", "rx", "pmo", "patient_medication_order"):
		return {
			"session": _healthcare_settings_flag("validate_dose_per_session_on_prescription"),
			"day": _healthcare_settings_flag("validate_dose_per_day_on_prescription"),
			"long_acting_period": _healthcare_settings_flag(
				"validate_long_acting_dose_period_on_prescription"
			),
			"context": "prescription",
		}
	# given medicine (default for administration flows)
	return {
		"session": _healthcare_settings_flag("validate_dose_per_session_on_given_medicine"),
		"day": _healthcare_settings_flag("validate_dose_per_day_on_given_medicine"),
		"long_acting_period": _healthcare_settings_flag(
			"validate_long_acting_dose_period_on_given_medicine"
		),
		"context": "given_medicine",
	}


def _normalize_row_time(value=None) -> str:
	if value is None:
		return now_datetime().strftime("%H:%M:%S")
	raw = str(value).strip() if value else ""
	if not raw:
		return now_datetime().strftime("%H:%M:%S")
	if " " in raw:
		raw = raw.split(" ")[-1]
	if "." in raw:
		raw = raw.split(".")[0]
	parts = raw.split(":")
	if len(parts) >= 2:
		try:
			hour = int(parts[0])
			minute = int(parts[1])
			second = int(parts[2]) if len(parts) > 2 else 0
			return f"{hour:02d}:{minute:02d}:{second:02d}"
		except ValueError:
			pass
	return raw[:8]


def extract_dose_numeric(value) -> float | None:
	"""Return the numeric portion of a dose string (e.g. ``50mg`` -> 50)."""
	if value is None or value == "":
		return None
	if isinstance(value, (int, float)):
		return flt(value)
	text = str(value).strip()
	if not text:
		return None
	match = re.search(r"\d+(?:\.\d+)?", text.replace(",", ""))
	if match:
		return flt(match.group())
	try:
		parsed = flt(text)
		return parsed if parsed != 0 or text in ("0", "0.0") else None
	except Exception:
		return None


def is_frequency_style_dosage(value) -> bool:
	"""True for schedule-like dosages such as ``1-0-1`` / ``1-1-1`` (not a single dose amount)."""
	if value is None:
		return False
	text = str(value).strip()
	if not text:
		return False
	return bool(re.match(r"^\d+(\.\d+)?\s*-\s*\d+", text))


def is_numeric_dose_input(value) -> bool:
	"""True when the value looks like a single dose amount (e.g. ``45``, ``45mg``), not a frequency."""
	if value is None or str(value).strip() == "":
		return False
	if is_frequency_style_dosage(value):
		return False
	return extract_dose_numeric(value) is not None


def _parse_item_dose_limit_detail(raw) -> dict | None:
	"""Parse Item max-dose text into absolute or weight-based (``mg/kg``) form."""
	if raw is None:
		return None
	text = str(raw).strip()
	if not text:
		return None
	lower = text.lower()
	if lower in ("not applicable", "n/a", "na", "-", "none"):
		return None

	weight_match = re.search(
		r"(\d+(?:\.\d+)?)\s*(mg|mcg|ug|µg|g|ml|iu)?\s*/\s*kg\b",
		text,
		flags=re.IGNORECASE,
	)
	if weight_match:
		amount = flt(weight_match.group(1))
		if amount <= 0:
			return None
		return {
			"raw": text,
			"amount": amount,
			"unit": (weight_match.group(2) or "").lower() or None,
			"weight_based": True,
		}

	parsed = extract_dose_numeric(text)
	if parsed is None or parsed <= 0:
		return None
	return {
		"raw": text,
		"amount": parsed,
		"unit": None,
		"weight_based": False,
	}


def _parse_item_dose_limit(raw) -> float | None:
	"""Absolute numeric ceiling only. Weight-based limits return None until weight is applied."""
	detail = _parse_item_dose_limit_detail(raw)
	if not detail or detail.get("weight_based"):
		return None
	return detail.get("amount")


def _read_item_dose_limit_raw(item_code: str, fieldname: str):
	if not item_code or not frappe.db.has_column("Item", fieldname):
		return None
	return frappe.db.get_value("Item", item_code, fieldname)


def _read_item_dose_limit(item_code: str, fieldname: str) -> float | None:
	return _parse_item_dose_limit(_read_item_dose_limit_raw(item_code, fieldname))


def _read_item_dose_limit_detail(item_code: str, fieldname: str) -> dict | None:
	return _parse_item_dose_limit_detail(_read_item_dose_limit_raw(item_code, fieldname))


def get_item_long_acting_dose_config(item_code: str) -> dict:
	"""Raw long-acting / depot dose fields from Item."""
	if not item_code:
		return {
			"single_raw": None,
			"period_raw": None,
			"period_max_raw": None,
			"remarks": None,
			"period_days": None,
		}
	from healthcare.api.injection_max_dose_import import dosing_period_to_days

	single_raw = _read_item_dose_limit_raw(item_code, "custom_maximum_single_dose_long_acting")
	period_raw = _read_item_dose_limit_raw(item_code, "custom_dosing_period_long_acting")
	period_max_raw = _read_item_dose_limit_raw(
		item_code, "custom_maximum_dose_within_the_period_long_acting"
	)
	remarks = _read_item_dose_limit_raw(item_code, "custom_long_acting_dose_remarks")
	period_text = str(period_raw).strip() if period_raw else ""
	return {
		"single_raw": single_raw,
		"period_raw": period_raw,
		"period_max_raw": period_max_raw,
		"remarks": remarks,
		"period_days": dosing_period_to_days(period_text),
	}


def _resolve_long_acting_ceilings(
	medicine_code: str,
	patient_weight: float | None = None,
	patient: str | None = None,
) -> dict:
	"""Ceilings from LAI Item fields only (never max-per-day)."""
	cfg = get_item_long_acting_dose_config(medicine_code)
	single_detail = _parse_item_dose_limit_detail(cfg.get("single_raw"))
	# Fallback: shared single-dose field if LAI-specific single is empty.
	if not single_detail:
		single_detail = _read_item_dose_limit_detail(
			medicine_code, "custom_max_dose_per_single_dose"
		) or _read_item_dose_limit_detail(medicine_code, "custom_maximum_dose_limit")
	period_detail = _parse_item_dose_limit_detail(cfg.get("period_max_raw"))

	single = resolve_dose_ceiling(single_detail, patient_weight)
	period = resolve_dose_ceiling(period_detail, patient_weight)

	if patient:
		from healthcare.api.dose_age_adjustment import adjust_ceiling_for_patient

		for band in (single, period):
			if band.get("ceiling") and not band.get("weight_based"):
				adj = adjust_ceiling_for_patient(patient, band["ceiling"])
				if adj.get("adjusted"):
					band["adult_ceiling"] = adj["adult_ceiling"]
					band["ceiling"] = adj["ceiling"]
					band["age_band"] = adj["age_band"]
					band["patient_category"] = adj["category"]
					band["adjustment_factor"] = adj["factor"]

	return {
		"single": single,
		"period": period,
		"period_days": cfg.get("period_days"),
		"period_label": cfg.get("period_raw"),
		"remarks": cfg.get("remarks"),
		"has_limit_config": bool(single_detail or period_detail),
		"requires_weight": bool(single.get("requires_weight") or period.get("requires_weight")),
	}


@frappe.whitelist()
def get_medicine_dose_limit_info(medicine_code: str, is_long_acting: int | bool = 0) -> dict:
	"""Return Item dose limits for prescription / given-medicine UI."""
	if not medicine_code:
		frappe.throw(frappe._("Medicine code is required"))
	lai = bool(cint(is_long_acting))
	daily_single = _read_item_dose_limit_raw(medicine_code, "custom_max_dose_per_single_dose")
	daily_day = _read_item_dose_limit_raw(medicine_code, "custom_max_dose_per_day")
	lai_cfg = get_item_long_acting_dose_config(medicine_code)
	return {
		"medicine_code": medicine_code,
		"is_long_acting": lai,
		"max_dose_per_single_dose": daily_single,
		"max_dose_per_day": daily_day,
		"long_acting_maximum_single_dose": lai_cfg.get("single_raw"),
		"long_acting_dosing_period": lai_cfg.get("period_raw"),
		"long_acting_maximum_dose_within_period": lai_cfg.get("period_max_raw"),
		"long_acting_dose_remarks": lai_cfg.get("remarks"),
		"long_acting_period_days": lai_cfg.get("period_days"),
		# Fields the UI should show for the current mode
		"display_single_dose": lai_cfg.get("single_raw") if lai else daily_single,
		"display_period_or_day": (
			lai_cfg.get("period_max_raw") if lai else daily_day
		),
		"display_period_label": lai_cfg.get("period_raw") if lai else "Daily (24 hours)",
		"display_remarks": lai_cfg.get("remarks") if lai else None,
	}


def _normalize_route_key(value) -> str:
	return " ".join(str(value or "").strip().lower().split())


def _maximum_dosage_child_meta():
	if not frappe.db.exists("DocType", "Maximum Dosage Detail"):
		return None
	try:
		return frappe.get_meta("Maximum Dosage Detail")
	except Exception:
		return None


def _maximum_dosage_field(meta, candidates: tuple[str, ...], *, must_include: str | None = None) -> str | None:
	if not meta:
		return None
	names = {df.fieldname for df in meta.fields}
	for name in candidates:
		if name in names:
			return name
	if must_include:
		for df in meta.fields:
			fn = (df.fieldname or "").lower()
			label = (df.label or "").lower()
			if must_include in fn or must_include in label:
				return df.fieldname
	return None


def _read_item_route_max_dose_rows(item_code: str) -> list[dict]:
	"""Rows from Item.custom_maximum_dosage (Maximum Dosage Detail). Empty list = use item-level fallback."""
	if not item_code or not frappe.db.exists("DocType", "Maximum Dosage Detail"):
		return []
	item_meta = frappe.get_meta("Item")
	if not item_meta.has_field("custom_maximum_dosage"):
		return []
	meta = _maximum_dosage_child_meta()
	if not meta:
		return []
	fields = [
		df.fieldname
		for df in meta.fields
		if df.fieldname and df.fieldtype not in ("Section Break", "Column Break", "Tab Break", "HTML")
	]
	if "name" not in fields:
		fields.insert(0, "name")
	try:
		return frappe.get_all(
			"Maximum Dosage Detail",
			filters={"parent": item_code, "parenttype": "Item"},
			fields=fields,
			ignore_permissions=True,
		) or []
	except Exception:
		return []


def _match_route_max_dose_row(rows: list[dict], route_of_administration: str | None, route_field: str | None):
	if not rows or not route_field:
		return None
	wanted = _normalize_route_key(route_of_administration)
	if not wanted:
		return None
	for row in rows:
		row_route = _normalize_route_key(row.get(route_field))
		if row_route and row_route == wanted:
			return row
	for row in rows:
		row_route = _normalize_route_key(row.get(route_field))
		if row_route and (row_route in wanted or wanted in row_route):
			return row
	return None


def _route_specific_dose_details(
	item_code: str, route_of_administration: str | None
) -> dict | None:
	"""If the route table has a matching row, return parsed single/daily details (priority over Item fields)."""
	rows = _read_item_route_max_dose_rows(item_code)
	if not rows:
		return None

	meta = _maximum_dosage_child_meta()
	route_field = _maximum_dosage_field(
		meta,
		("route_of_administration", "route", "custom_route_of_administration"),
		must_include="route",
	)
	single_field = _maximum_dosage_field(
		meta,
		(
			"max_dose_per_single_dose",
			"maximum_dose_per_single_dose",
			"max_single_dose",
			"custom_max_dose_per_single_dose",
		),
		must_include="single",
	)
	daily_field = _maximum_dosage_field(
		meta,
		(
			"max_dose_per_day",
			"maximum_dose_per_day",
			"max_daily_dose",
			"custom_max_dose_per_day",
		),
		must_include="day",
	)
	matched = _match_route_max_dose_row(rows, route_of_administration, route_field)
	if not matched:
		return None

	single_detail = _parse_item_dose_limit_detail(matched.get(single_field) if single_field else None)
	daily_detail = _parse_item_dose_limit_detail(matched.get(daily_field) if daily_field else None)
	if not single_detail and not daily_detail:
		return None
	return {
		"single": single_detail,
		"daily": daily_detail,
		"route": matched.get(route_field) if route_field else route_of_administration,
	}


def get_patient_weight_kg(
	*,
	patient: str | None = None,
	patient_encounter: str | None = None,
	inpatient_record: str | None = None,
	patient_weight=None,
	admission: str | None = None,
) -> float | None:
	"""Resolve patient weight (kg) from explicit value, visit, admission, or latest vitals."""
	if patient_weight is not None and str(patient_weight).strip() != "":
		w = flt(patient_weight)
		if w > 0:
			return w

	visit = (patient_encounter or "").strip()
	if visit and frappe.db.exists("Patient Visit", visit):
		if frappe.db.has_column("Patient Visit", "patient_weight"):
			w = flt(frappe.db.get_value("Patient Visit", visit, "patient_weight"))
			if w > 0:
				return w
		if not patient:
			patient = frappe.db.get_value("Patient Visit", visit, "patient")

	admission_name = (inpatient_record or admission or "").strip()
	if admission_name and frappe.db.exists("Inpatient Admission", admission_name):
		if frappe.db.has_column("Inpatient Admission", "weight"):
			w = flt(frappe.db.get_value("Inpatient Admission", admission_name, "weight"))
			if w > 0:
				return w
		if not patient:
			patient = frappe.db.get_value("Inpatient Admission", admission_name, "patient")

	patient_name = (patient or "").strip()
	if patient_name and frappe.db.exists("DocType", "Vital Signs"):
		rows = frappe.get_all(
			"Vital Signs",
			filters={"patient": patient_name},
			fields=["weight"],
			order_by="modified desc",
			limit=1,
			ignore_permissions=True,
		)
		if rows and flt(rows[0].get("weight")) > 0:
			return flt(rows[0].get("weight"))

	return None


def resolve_dose_ceiling(detail: dict | None, patient_weight: float | None = None) -> dict:
	"""Compute an absolute ceiling from a parsed limit detail + optional weight."""
	result = {
		"ceiling": None,
		"weight_based": False,
		"requires_weight": False,
		"rate_per_kg": None,
		"patient_weight": patient_weight,
		"raw": None,
	}
	if not detail:
		return result

	result["raw"] = detail.get("raw")
	if detail.get("weight_based"):
		result["weight_based"] = True
		result["rate_per_kg"] = detail.get("amount")
		if patient_weight and patient_weight > 0:
			result["ceiling"] = flt(detail.get("amount")) * flt(patient_weight)
		else:
			result["requires_weight"] = True
		return result

	result["ceiling"] = detail.get("amount")
	return result


def get_item_max_dose_per_single_dose(
	item_code: str,
	patient_weight: float | None = None,
	route_of_administration: str | None = None,
) -> float | None:
	"""Max allowed per single administration (absolute). Weight-based needs patient_weight."""
	ceilings = _resolve_single_and_daily_ceilings(item_code, patient_weight, route_of_administration=route_of_administration)
	return ceilings["single"].get("ceiling")


def get_item_max_dose_per_day(
	item_code: str,
	patient_weight: float | None = None,
	route_of_administration: str | None = None,
) -> float | None:
	"""Max allowed cumulative dose in rolling 24 hours."""
	ceilings = _resolve_single_and_daily_ceilings(item_code, patient_weight, route_of_administration=route_of_administration)
	return ceilings["daily"].get("ceiling")


def get_item_maximum_dose_limit(
	item_code: str,
	patient_weight: float | None = None,
	route_of_administration: str | None = None,
) -> float | None:
	"""Backward-compatible alias for single-dose ceiling."""
	return get_item_max_dose_per_single_dose(item_code, patient_weight, route_of_administration)


def _resolve_single_and_daily_ceilings(
	medicine_code: str,
	patient_weight: float | None,
	patient: str | None = None,
	route_of_administration: str | None = None,
) -> dict:
	route_details = _route_specific_dose_details(medicine_code, route_of_administration)
	used_route = bool(route_details)

	item_single = _read_item_dose_limit_detail(
		medicine_code, "custom_max_dose_per_single_dose"
	) or _read_item_dose_limit_detail(medicine_code, "custom_maximum_dose_limit")
	item_daily = _read_item_dose_limit_detail(
		medicine_code, "custom_max_dose_per_day"
	) or _read_item_dose_limit_detail(medicine_code, "custom_maximum_dose_limit")

	if used_route:
		single_detail = route_details.get("single") or item_single
		daily_detail = route_details.get("daily") or item_daily
	else:
		single_detail = item_single
		daily_detail = item_daily

	single = resolve_dose_ceiling(single_detail, patient_weight)
	daily = resolve_dose_ceiling(daily_detail, patient_weight)

	# DOC-124: tighten the adult ceiling for paediatric / geriatric patients and
	# for patient categories carrying their own dose factor. Weight-based limits
	# are already patient-specific, so they are left alone.
	if patient:
		from healthcare.api.dose_age_adjustment import adjust_ceiling_for_patient

		for band in (single, daily):
			if band.get("ceiling") and not band.get("weight_based"):
				adj = adjust_ceiling_for_patient(patient, band["ceiling"])
				if adj.get("adjusted"):
					band["adult_ceiling"] = adj["adult_ceiling"]
					band["ceiling"] = adj["ceiling"]
					band["age_band"] = adj["age_band"]
					band["patient_category"] = adj["category"]
					band["adjustment_factor"] = adj["factor"]

	return {
		"single": single,
		"daily": daily,
		"has_limit_config": bool(single_detail or daily_detail),
		"requires_weight": bool(single.get("requires_weight") or daily.get("requires_weight")),
		"route_specific": used_route,
		"matched_route": (route_details or {}).get("route") if used_route else None,
	}


def medicine_given_datetime(date_value, time_value=None):
	date_part = getdate(date_value) if date_value else getdate(nowdate())
	time_part = _normalize_row_time(time_value)
	return get_datetime(f"{date_part} {time_part}")


def get_cumulative_dose_24h(
	*,
	admission_detail_name: str,
	medicine_code: str,
	record_datetime,
	exclude_row_name: str | None = None,
) -> float:
	"""Sum numeric dose qty for the same drug in the rolling 24 hours ending at record_datetime."""
	return get_cumulative_dose_in_period(
		admission_detail_name=admission_detail_name,
		medicine_code=medicine_code,
		record_datetime=record_datetime,
		period_days=1,
		exclude_row_name=exclude_row_name,
		hours=24,
	)


def get_cumulative_dose_in_period(
	*,
	admission_detail_name: str,
	medicine_code: str,
	record_datetime,
	period_days: int | None = None,
	exclude_row_name: str | None = None,
	hours: int | None = None,
) -> float:
	"""Sum numeric doses for the same drug in a rolling window ending at record_datetime."""
	if not admission_detail_name or not medicine_code or not record_datetime:
		return 0.0
	if hours is not None:
		window_start = add_to_date(record_datetime, hours=-int(hours))
	else:
		days = cint(period_days) or 0
		if days <= 0:
			return 0.0
		window_start = add_to_date(record_datetime, days=-days)

	fields = ["name", "date", "time", "qty"]
	if frappe.db.has_column("Medicine Given", "dose"):
		fields.insert(3, "dose")
	rows = frappe.get_all(
		"Medicine Given",
		filters={
			"parent": admission_detail_name,
			"parenttype": "Admission Detail",
			"medicine_code": medicine_code,
		},
		fields=fields,
		ignore_permissions=True,
	)

	total = 0.0
	for row in rows:
		if exclude_row_name and row.name == exclude_row_name:
			continue
		row_dt = medicine_given_datetime(row.date, row.time)
		if row_dt < window_start or row_dt > record_datetime:
			continue
		dose_value = row.dose if (getattr(row, "dose", None) or "").strip() else row.qty
		total += extract_dose_numeric(dose_value) or 0.0
	return total


def evaluate_dose_against_item_limits(
	*,
	medicine_code: str,
	dose,
	patient_weight: float | None = None,
	skip_if_frequency_style: bool = False,
	patient: str | None = None,
	route_of_administration: str | None = None,
	validate_session: bool | None = None,
	validate_day: bool | None = None,
	validate_long_acting_period: bool | None = None,
	context: str | None = None,
	is_long_acting: bool | int | None = False,
) -> dict:
	"""Check entered dose against Item single/daily or long-acting period ceilings.

	When ``is_long_acting`` is true, daily (24h) Item fields and the daily session/day
	toggles are ignored. Long-acting warnings run only when the Healthcare Settings
	checkbox ``Validate Long-Acting Dose Period on …`` is enabled for this context.
	"""
	lai = bool(cint(is_long_acting))
	if validate_session is None or validate_day is None or validate_long_acting_period is None:
		toggles = dose_validation_toggles(context or "prescription")
		if validate_session is None:
			validate_session = toggles["session"]
		if validate_day is None:
			validate_day = toggles["day"]
		if validate_long_acting_period is None:
			validate_long_acting_period = toggles.get("long_acting_period")
	validate_session = bool(validate_session)
	validate_day = bool(validate_day) and not lai  # never use 24h daily rules for LAI
	validate_long_acting_period = bool(validate_long_acting_period) and lai

	frequency_style = is_frequency_style_dosage(dose)
	entered_dose = None if (skip_if_frequency_style and frequency_style) else extract_dose_numeric(dose)

	if lai:
		# LAI lines are gated solely by the long-acting settings checkbox.
		# Unchecked → no long-acting dose warnings (ignore daily session/day toggles).
		if not validate_long_acting_period:
			return {
				"ok": True,
				"has_limit": False,
				"is_long_acting": True,
				"weight_based": False,
				"requires_weight": False,
				"patient_weight": patient_weight,
				"rate_per_kg": None,
				"limit_raw": None,
				"single_dose_ceiling": None,
				"daily_dose_ceiling": None,
				"period_dose_ceiling": None,
				"period_days": None,
				"period_label": None,
				"long_acting_remarks": None,
				"ceiling": None,
				"maximum_dose_limit": None,
				"max_dose_per_single_dose": None,
				"max_dose_per_day": None,
				"entered_dose": entered_dose,
				"frequency_style_dosage": frequency_style,
				"exceeds_single_dose": False,
				"exceeds_cumulative_24h": False,
				"exceeds_period": False,
				"prior_24h_dose": 0.0,
				"prior_period_dose": 0.0,
				"cumulative_24h_with_new_dose": entered_dose or 0.0,
				"cumulative_period_with_new_dose": entered_dose or 0.0,
				"medicine_code": medicine_code,
				"route_of_administration": route_of_administration,
				"route_specific": False,
				"matched_route": None,
				"validate_session": False,
				"validate_day": False,
				"validate_long_acting_period": False,
			}

		ceilings = _resolve_long_acting_ceilings(medicine_code, patient_weight, patient)
		single = ceilings["single"]
		period = ceilings["period"]
		single_ceiling = single.get("ceiling")
		period_ceiling = period.get("ceiling")
		requires_weight = bool(single.get("requires_weight") or period.get("requires_weight"))
		has_limit_config = bool(
			single.get("raw")
			or single.get("requires_weight")
			or single.get("ceiling") is not None
			or period.get("raw")
			or period.get("requires_weight")
			or period.get("ceiling") is not None
		)
		result = {
			"ok": True,
			"has_limit": bool(has_limit_config),
			"is_long_acting": True,
			"weight_based": bool(single.get("weight_based") or period.get("weight_based")),
			"requires_weight": bool(requires_weight),
			"patient_weight": patient_weight,
			"rate_per_kg": single.get("rate_per_kg") or period.get("rate_per_kg"),
			"limit_raw": single.get("raw") or period.get("raw"),
			"single_dose_ceiling": single_ceiling,
			"daily_dose_ceiling": None,
			"period_dose_ceiling": period_ceiling,
			"period_days": ceilings.get("period_days"),
			"period_label": ceilings.get("period_label"),
			"long_acting_remarks": ceilings.get("remarks"),
			"ceiling": single_ceiling,
			"maximum_dose_limit": single_ceiling,
			"max_dose_per_single_dose": single_ceiling,
			"max_dose_per_day": None,
			"entered_dose": entered_dose,
			"frequency_style_dosage": frequency_style,
			"exceeds_single_dose": False,
			"exceeds_cumulative_24h": False,
			"exceeds_period": False,
			"prior_24h_dose": 0.0,
			"prior_period_dose": 0.0,
			"cumulative_24h_with_new_dose": entered_dose or 0.0,
			"cumulative_period_with_new_dose": entered_dose or 0.0,
			"medicine_code": medicine_code,
			"route_of_administration": route_of_administration,
			"route_specific": False,
			"matched_route": None,
			"validate_session": True,
			"validate_day": False,
			"validate_long_acting_period": True,
		}
		if not result["has_limit"]:
			return result
		if result["requires_weight"]:
			if entered_dose is not None:
				result["ok"] = False
			return result
		if entered_dose is None:
			return result
		if single_ceiling is not None:
			result["exceeds_single_dose"] = entered_dose > single_ceiling
		if period_ceiling is not None:
			result["exceeds_period"] = entered_dose > period_ceiling
			result["cumulative_period_with_new_dose"] = entered_dose
		result["ok"] = not (result["exceeds_single_dose"] or result["exceeds_period"])
		return result

	ceilings = _resolve_single_and_daily_ceilings(
		medicine_code,
		patient_weight,
		patient,
		route_of_administration=route_of_administration,
	)
	single = ceilings["single"] if validate_session else {}
	daily = ceilings["daily"] if validate_day else {}
	single_ceiling = single.get("ceiling") if validate_session else None
	daily_ceiling = daily.get("ceiling") if validate_day else None

	# Weight is only required when an enabled check depends on it.
	requires_weight = False
	if validate_session and single.get("requires_weight"):
		requires_weight = True
	if validate_day and daily.get("requires_weight"):
		requires_weight = True

	orig_single = ceilings["single"]
	orig_daily = ceilings["daily"]
	has_limit_config = bool(
		(validate_session and (orig_single.get("raw") or orig_single.get("requires_weight") or orig_single.get("ceiling") is not None))
		or (validate_day and (orig_daily.get("raw") or orig_daily.get("requires_weight") or orig_daily.get("ceiling") is not None))
	)

	result = {
		"ok": True,
		"has_limit": bool(has_limit_config),
		"is_long_acting": False,
		"weight_based": bool(
			(validate_session and single.get("weight_based"))
			or (validate_day and daily.get("weight_based"))
		),
		"requires_weight": bool(requires_weight),
		"patient_weight": patient_weight,
		"rate_per_kg": (single.get("rate_per_kg") if validate_session else None)
		or (daily.get("rate_per_kg") if validate_day else None),
		"limit_raw": (single.get("raw") if validate_session else None)
		or (daily.get("raw") if validate_day else None),
		"single_dose_ceiling": single_ceiling,
		"daily_dose_ceiling": daily_ceiling,
		"period_dose_ceiling": None,
		"period_days": None,
		"period_label": None,
		"long_acting_remarks": None,
		"ceiling": single_ceiling,
		"maximum_dose_limit": single_ceiling,
		"max_dose_per_single_dose": single_ceiling,
		"max_dose_per_day": daily_ceiling,
		"entered_dose": entered_dose,
		"frequency_style_dosage": frequency_style,
		"exceeds_single_dose": False,
		"exceeds_cumulative_24h": False,
		"exceeds_period": False,
		"prior_24h_dose": 0.0,
		"prior_period_dose": 0.0,
		"cumulative_24h_with_new_dose": entered_dose or 0.0,
		"cumulative_period_with_new_dose": entered_dose or 0.0,
		"medicine_code": medicine_code,
		"route_of_administration": route_of_administration,
		"route_specific": bool(ceilings.get("route_specific")),
		"matched_route": ceilings.get("matched_route"),
		"validate_session": validate_session,
		"validate_day": validate_day,
		"validate_long_acting_period": False,
	}

	# Both toggles off → never block
	if not validate_session and not validate_day:
		result["has_limit"] = False
		return result

	if not result["has_limit"]:
		return result

	if result["requires_weight"]:
		# Only block when a numeric single dose was entered; frequency strings can't be checked yet.
		if entered_dose is not None:
			result["ok"] = False
		return result

	if entered_dose is None:
		return result

	if validate_session and single_ceiling is not None:
		result["exceeds_single_dose"] = entered_dose > single_ceiling
	if validate_day and daily_ceiling is not None:
		result["exceeds_cumulative_24h"] = entered_dose > daily_ceiling
		result["cumulative_24h_with_new_dose"] = entered_dose
	result["ok"] = not (result["exceeds_single_dose"] or result["exceeds_cumulative_24h"])
	return result


def evaluate_medicine_given_dose(
	*,
	admission_detail_name: str,
	medicine_code: str,
	dose,
	date_value=None,
	time_value=None,
	exclude_row_name: str | None = None,
	patient_weight: float | None = None,
	patient: str | None = None,
	admission: str | None = None,
	route_of_administration: str | None = None,
	is_long_acting: bool | int | None = None,
	order_entry: str | None = None,
) -> dict:
	"""Check single-dose ceiling and rolling period / 24-hour cumulative dose (Given Medicine)."""
	toggles = dose_validation_toggles("given_medicine")
	validate_session = toggles["session"]
	validate_day = toggles["day"]
	validate_long_acting_period = toggles.get("long_acting_period")

	if is_long_acting is None and order_entry:
		is_long_acting = cint(
			frappe.db.get_value("Inpatient Medication Order Entry", order_entry, "is_long_acting_medicine")
			or 0
		)
	lai = bool(cint(is_long_acting))

	if patient_weight is None:
		if not admission and admission_detail_name:
			admission = frappe.db.get_value("Admission Detail", admission_detail_name, "admission")
		patient_weight = get_patient_weight_kg(
			patient=patient,
			inpatient_record=admission,
			admission=admission,
			patient_weight=patient_weight,
		)

	result = evaluate_dose_against_item_limits(
		medicine_code=medicine_code,
		dose=dose,
		patient_weight=patient_weight,
		skip_if_frequency_style=False,
		patient=patient,
		route_of_administration=route_of_administration,
		validate_session=validate_session,
		validate_day=validate_day,
		validate_long_acting_period=validate_long_acting_period,
		context="given_medicine",
		is_long_acting=lai,
	)

	if lai:
		if not validate_long_acting_period:
			return result
	elif not validate_session and not validate_day:
		return result

	if result.get("requires_weight") or not result.get("has_limit") or result.get("entered_dose") is None:
		return result

	entered_dose = result["entered_dose"]
	record_datetime = medicine_given_datetime(date_value, time_value)

	if lai:
		single_ceiling = result.get("single_dose_ceiling")
		period_ceiling = result.get("period_dose_ceiling")
		period_days = cint(result.get("period_days") or 0)
		prior_period = 0.0
		cumulative_with_new = entered_dose
		if period_ceiling is not None and period_days > 0:
			prior_period = get_cumulative_dose_in_period(
				admission_detail_name=admission_detail_name,
				medicine_code=medicine_code,
				record_datetime=record_datetime,
				period_days=period_days,
				exclude_row_name=exclude_row_name,
			)
			cumulative_with_new = prior_period + entered_dose
		result["prior_period_dose"] = prior_period
		result["cumulative_period_with_new_dose"] = cumulative_with_new
		result["exceeds_single_dose"] = (
			single_ceiling is not None and entered_dose > single_ceiling
		)
		result["exceeds_period"] = (
			period_ceiling is not None and cumulative_with_new > period_ceiling
		)
		result["exceeds_cumulative_24h"] = False
		result["ok"] = not (result["exceeds_single_dose"] or result["exceeds_period"])
		return result

	single_ceiling = result.get("single_dose_ceiling") if validate_session else None
	daily_ceiling = result.get("daily_dose_ceiling") if validate_day else None
	prior_24h = 0.0
	cumulative_with_new = entered_dose
	if validate_day and daily_ceiling is not None:
		prior_24h = get_cumulative_dose_24h(
			admission_detail_name=admission_detail_name,
			medicine_code=medicine_code,
			record_datetime=record_datetime,
			exclude_row_name=exclude_row_name,
		)
		cumulative_with_new = prior_24h + entered_dose

	result["prior_24h_dose"] = prior_24h
	result["cumulative_24h_with_new_dose"] = cumulative_with_new
	result["exceeds_single_dose"] = (
		validate_session and single_ceiling is not None and entered_dose > single_ceiling
	)
	result["exceeds_cumulative_24h"] = (
		validate_day and daily_ceiling is not None and cumulative_with_new > daily_ceiling
	)
	result["ok"] = not (result["exceeds_single_dose"] or result["exceeds_cumulative_24h"])
	return result


def dose_limit_validation_message(evaluation: dict) -> str:
	if evaluation.get("ok"):
		return ""

	lines: list[str] = []
	if evaluation.get("requires_weight"):
		raw = evaluation.get("limit_raw") or "mg/kg"
		rate = evaluation.get("rate_per_kg")
		rate_bit = f" ({rate} mg/kg)" if rate else f" ({raw})"
		entered = evaluation.get("entered_dose")
		entered_bit = (
			frappe._(" Entered dose: {0}.").format(entered) if entered is not None else ""
		)
		lines.append(
			frappe._(
				"This medicine has a weight-based maximum dose{0}.{1} "
				"Add patient weight (kg) to validate against the max single dose."
			).format(rate_bit, entered_bit)
		)
		return "\n".join(lines)

	entered = evaluation.get("entered_dose")
	single_ceiling = evaluation.get("single_dose_ceiling")
	daily_ceiling = evaluation.get("daily_dose_ceiling")
	route_bit = ""
	if evaluation.get("route_specific") and evaluation.get("matched_route"):
		route_bit = frappe._(" for route {0}").format(evaluation.get("matched_route"))
	if evaluation.get("exceeds_single_dose") and evaluation.get("validate_session", True):
		extra = ""
		if evaluation.get("weight_based") and evaluation.get("patient_weight"):
			extra = frappe._(" (based on patient weight {0} kg)").format(
				evaluation.get("patient_weight")
			)
		label = (
			frappe._("maximum long-acting single dose")
			if evaluation.get("is_long_acting")
			else frappe._("maximum single dose")
		)
		lines.append(
			frappe._(
				"Entered dose ({0}) exceeds the {1} ({2}) for this medicine{3}{4}."
			).format(entered, label, single_ceiling, extra, route_bit)
		)
	if evaluation.get("is_long_acting") and evaluation.get("exceeds_period") and evaluation.get(
		"validate_long_acting_period", True
	):
		period_label = evaluation.get("period_label") or frappe._("dosing period")
		days = evaluation.get("period_days")
		days_bit = frappe._(" ({0} days)").format(days) if days else ""
		lines.append(
			frappe._(
				"Entered dose exceeds the long-acting maximum for {0}{1}. "
				"Period cumulative dose ({2}) would exceed the maximum ({3}). "
				"Doses already given in this period: {4}."
			).format(
				period_label,
				days_bit,
				evaluation.get("cumulative_period_with_new_dose"),
				evaluation.get("period_dose_ceiling"),
				evaluation.get("prior_period_dose"),
			)
		)
	elif evaluation.get("exceeds_cumulative_24h") and evaluation.get("validate_day", True):
		# DOC-117: the BRD specifies this exact alert wording.
		lines.append(
			frappe._(
				"Entered dose exceeds recommended maximum daily dose. "
				"24-hour cumulative dose ({0}) would exceed the maximum daily dose ({1}). "
				"Doses already given in the last 24 hours: {2}."
			).format(
				evaluation.get("cumulative_24h_with_new_dose"),
				daily_ceiling,
				evaluation.get("prior_24h_dose"),
			)
		)
	return "\n".join(lines)


def apply_dose_limit_override_audit(row, evaluation: dict, override_reason: str) -> None:
	session_on = evaluation.get("validate_session", True)
	day_on = evaluation.get("validate_day", True)
	period_on = evaluation.get("validate_long_acting_period", False)
	if frappe.db.has_column("Medicine Given", "override_exceeded_dose_limit"):
		row.override_exceeded_dose_limit = (
			1 if session_on and evaluation.get("exceeds_single_dose") else 0
		)
	if frappe.db.has_column("Medicine Given", "override_exceeded_cumulative_24h"):
		row.override_exceeded_cumulative_24h = (
			1
			if (day_on and evaluation.get("exceeds_cumulative_24h"))
			or (period_on and evaluation.get("exceeds_period"))
			else 0
		)
	if hasattr(row, "override_reason"):
		row.override_reason = override_reason
	if hasattr(row, "override_user"):
		row.override_user = frappe.session.user
	if hasattr(row, "override_timestamp"):
		from frappe.utils import now_datetime

		row.override_timestamp = now_datetime()


def validate_medicine_given_dose_or_throw(
	*,
	admission_detail_name: str,
	medicine_code: str,
	dose,
	date_value=None,
	time_value=None,
	allow_override: int | bool = 0,
	override_reason: str | None = None,
	exclude_row_name: str | None = None,
	patient_weight=None,
	patient: str | None = None,
	admission: str | None = None,
	route_of_administration: str | None = None,
	is_long_acting: bool | int | None = None,
	order_entry: str | None = None,
) -> dict:
	evaluation = evaluate_medicine_given_dose(
		admission_detail_name=admission_detail_name,
		medicine_code=medicine_code,
		dose=dose,
		date_value=date_value,
		time_value=time_value,
		exclude_row_name=exclude_row_name,
		patient_weight=flt(patient_weight) if patient_weight not in (None, "") else None,
		patient=patient,
		admission=admission,
		route_of_administration=route_of_administration,
		is_long_acting=is_long_acting,
		order_entry=order_entry,
	)
	if evaluation.get("ok") or not evaluation.get("has_limit"):
		return evaluation

	# Weight-based limit with no weight: soft block (same as exceed — needs attention / override)
	if not allow_override:
		frappe.throw(
			dose_limit_validation_message(evaluation),
			title=frappe._("Maximum dose limit exceeded")
			if not evaluation.get("requires_weight")
			else frappe._("Patient weight required"),
		)
	if not (override_reason or "").strip():
		frappe.throw(
			frappe._("Override reason is required to exceed the maximum dose limit."),
			title=frappe._("Override reason required"),
		)
	evaluation["override_required"] = True
	return evaluation


@frappe.whitelist()
def preview_prescription_dose_validation(
	medicine_code: str,
	dose,
	patient: str | None = None,
	patient_encounter: str | None = None,
	inpatient_record: str | None = None,
	patient_weight=None,
	route_of_administration: str | None = None,
	is_long_acting: int | bool = 0,
) -> dict:
	"""Preview max-dose checks while creating/editing a prescription dosage."""
	if not medicine_code:
		frappe.throw(frappe._("Medicine code is required"))
	if dose is None or str(dose).strip() == "":
		return {
			"ok": True,
			"has_limit": False,
			"message": "",
		}

	weight = get_patient_weight_kg(
		patient=patient,
		patient_encounter=patient_encounter,
		inpatient_record=inpatient_record,
		patient_weight=patient_weight,
	)
	evaluation = evaluate_dose_against_item_limits(
		medicine_code=medicine_code,
		dose=dose,
		patient_weight=weight,
		skip_if_frequency_style=True,
		patient=patient,
		route_of_administration=route_of_administration,
		context="prescription",
		is_long_acting=is_long_acting,
	)
	return {
		**evaluation,
		"parsed_dose": evaluation.get("entered_dose"),
		"message": dose_limit_validation_message(evaluation),
	}
