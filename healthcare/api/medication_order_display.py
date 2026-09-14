"""Display fallbacks for Patient Medication Order child rows (legacy Oracle imports)."""

from __future__ import annotations

from typing import Any

from frappe.utils import cint


def _text(value: Any) -> str:
	if value is None or value == "":
		return ""
	if isinstance(value, float) and value == int(value):
		return str(int(value))
	if isinstance(value, int):
		return str(value)
	return str(value).strip()


def is_legacy_medication_entry(entry: dict | Any) -> bool:
	data = entry if isinstance(entry, dict) else entry.as_dict()
	drug = _text(data.get("drug"))
	if drug:
		return False
	return bool(
		_text(data.get("old_medicine_code"))
		or _text(data.get("old_medicine_name"))
		or _text(data.get("medication"))
		or _text(data.get("medicine_no"))
		or _text(data.get("trans_num"))
		or _text(data.get("reference_no"))
		or _text(data.get("written_frequency"))
	)


def medication_entry_drug_key(entry: dict | Any) -> str:
	"""Stable key for matching administrations to a medication line."""
	data = entry if isinstance(entry, dict) else entry.as_dict()
	return (
		_text(data.get("drug"))
		or _text(data.get("old_medicine_code"))
		or _text(data.get("medicine_no"))
	)


def medication_entry_is_stopped(entry: dict | Any) -> bool:
	data = entry if isinstance(entry, dict) else entry.as_dict()
	stopped = bool(_text(data.get("reason_stopped"))) or cint(data.get("stopped"))
	status = _text(data.get("medication_status"))
	effective = _text(data.get("effective_status")).lower()
	legacy_status = _text(data.get("status")).lower()
	return bool(
		stopped
		or status == "Discontinued"
		or bool(_text(data.get("stopped_date")))
		or effective in ("stopped", "discontinued")
		or legacy_status in ("stopped", "discontinued")
	)


def _date_only(value: Any) -> str | None:
	text = _text(value)
	if not text:
		return None
	return text[:10]


def resolve_medication_end_date(
	entry: dict | Any,
	*,
	parent_end_date=None,
	discontinued_on=None,
) -> str | None:
	"""Best available end/stop date for a medication line.

	Order (do not parse free-text comments/instructions):
	1. line ``end_date``
	2. ``stopped_date`` when the line is stopped
	3. ``discontinued_on`` (Medication Status Log / precomputed)
	4. child row ``modified`` when stopped (approx. last change that set stop)
	5. parent end date only for legacy imports
	"""
	data = entry if isinstance(entry, dict) else entry.as_dict()
	line_end = _date_only(data.get("end_date"))
	if line_end:
		return line_end

	is_stopped = medication_entry_is_stopped(data)
	if is_stopped:
		line_end = (
			_date_only(data.get("stopped_date"))
			or _date_only(discontinued_on)
			or _date_only(data.get("discontinued_on"))
			or _date_only(data.get("modified"))
		)
		if line_end:
			return line_end

	if is_legacy_medication_entry(data):
		return _date_only(parent_end_date)
	return None


def medication_entry_display_fields(
	entry: dict | Any,
	*,
	parent_start_date=None,
	parent_end_date=None,
	discontinued_on=None,
) -> dict[str, Any]:
	data = entry if isinstance(entry, dict) else entry.as_dict()
	legacy = is_legacy_medication_entry(data)
	instructions = _text(data.get("instructions"))
	dosage = _text(data.get("dosage"))
	strength = _text(data.get("strength"))

	if legacy:
		display_dosage = instructions or dosage or strength
	else:
		display_dosage = dosage or instructions or strength

	uom = _text(data.get("uom"))
	if display_dosage and uom and uom.lower() not in display_dosage.lower():
		display_dosage = f"{display_dosage} {uom}"

	display_drug = medication_entry_drug_key(data)
	display_drug_name = (
		_text(data.get("drug_name"))
		or _text(data.get("medication"))
		or _text(data.get("old_medicine_name"))
		or display_drug
	)
	display_frequency = _text(data.get("patient_frequency")) or _text(data.get("written_frequency"))
	line_date = data.get("date") or parent_start_date
	line_end = resolve_medication_end_date(
		data,
		parent_end_date=parent_end_date,
		discontinued_on=discontinued_on,
	)

	return {
		"display_drug": display_drug or None,
		"display_drug_name": display_drug_name or "-",
		"display_dosage": display_dosage or "-",
		"display_frequency": display_frequency or "-",
		"display_start_date": str(line_date) if line_date else None,
		"display_end_date": line_end,
		"is_legacy": legacy,
	}
