"""Display fallbacks for Patient Medication Order child rows (legacy Oracle imports)."""

from __future__ import annotations

from typing import Any


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


def medication_entry_display_fields(
	entry: dict | Any,
	*,
	parent_start_date=None,
	parent_end_date=None,
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
	# Non-legacy: only the line's own end date. Parent/header end_date is never a fallback.
	# Legacy imports may omit line end dates — allow parent only then.
	line_end = data.get("end_date")
	if not line_end and legacy:
		line_end = parent_end_date

	return {
		"display_drug": display_drug or None,
		"display_drug_name": display_drug_name or "-",
		"display_dosage": display_dosage or "-",
		"display_frequency": display_frequency or "-",
		"display_start_date": str(line_date) if line_date else None,
		"display_end_date": str(line_end) if line_end else None,
		"is_legacy": legacy,
	}
