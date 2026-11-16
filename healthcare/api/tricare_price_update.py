"""Update TRICARE Health Insurance inclusive prices from June 2026 Excel price lists.

Old period prices → standalone Insurance History Prices documents.
New prices (effective June 16, 2026 onward) → Insurance Item Detail.price on TRICARE.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from healthcare.api.health_insurance_price_list_import import (
	_build_lab_template_index,
	_build_service_index,
	_get_or_create_lab_template,
	_get_or_create_service_template,
	_has_discount,
	_is_data_row,
	_is_ip_service_code,
	_is_lab_test_code,
	_item_name,
	_load_workbook,
	_norm_code,
	_norm_header_cell,
	_norm_name,
	_parse_price,
	_resolve_lab_sheet_header,
	_resolve_lab_template,
	_resolve_service_template,
	_find_lab_header,
)
from healthcare.healthcare.api.insurance_claim import TRICARE, _ensure_tricare

NEW_FROM = date(2026, 6, 16)
NEW_TO = date(2027, 12, 31)

# June 16 2026 lab price list: 1% inpatient / 6% outpatient.
LAB_IP_PCT = 1.0
LAB_OP_PCT = 6.0
# Service-type discounts for the new period (the other channel is 0%, not blank).
IP_SERVICE_DISC_PCT = 3.0
OP_SERVICE_DISC_PCT = 20.0


def _parse_percent_from_header(label: Any) -> float | None:
	text = str(label or "")
	match = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
	if not match:
		return None
	return flt(match.group(1))


def _parse_effective_dates(label: Any) -> tuple[date | None, date | None]:
	"""Parse 'Effective June 16 2026 - December 31, 2027' style labels."""
	text = re.sub(r"\s+", " ", str(label or "").strip())
	if not text:
		return None, None

	text = re.sub(r"(?i)^effective\s+", "", text)
	text = text.replace(",", "")

	# Range with hyphen / en-dash / to
	parts = re.split(r"\s*(?:-|–|to)\s*", text, maxsplit=1, flags=re.IGNORECASE)
	start = _coerce_date_fragment(parts[0] if parts else "")
	end = _coerce_date_fragment(parts[1]) if len(parts) > 1 else None
	return start, end


def _coerce_date_fragment(fragment: str) -> date | None:
	fragment = re.sub(r"\s+", " ", (fragment or "").strip())
	if not fragment:
		return None

	# Strip ordinal suffixes: 01st → 01, 1st → 1
	fragment = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", fragment, flags=re.IGNORECASE)

	for fmt in ("%B %d %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y", "%Y-%m-%d"):
		try:
			from datetime import datetime

			return datetime.strptime(fragment, fmt).date()
		except ValueError:
			continue
	return None


def _is_new_period(from_date: date | None, to_date: date | None, label: str = "") -> bool:
	label_u = (label or "").upper()
	if "JUNE 16" in label_u and "2026" in label_u:
		return True
	if from_date and from_date >= NEW_FROM:
		return True
	if to_date and to_date >= NEW_FROM and from_date and from_date >= date(2026, 1, 1):
		# avoid treating multi-year ranges that start earlier as "new"
		pass
	return bool(from_date and from_date >= NEW_FROM)


def _default_new_dates() -> tuple[date, date]:
	return NEW_FROM, NEW_TO


def _upsert_history(payload: dict) -> str:
	"""Create Insurance History Prices if a matching period row does not already exist."""
	filters = {
		"health_insurance": payload["health_insurance"],
		"from_date": payload.get("from_date"),
		"to_date": payload.get("to_date"),
	}
	if payload.get("lab_test_template"):
		filters["lab_test_template"] = payload["lab_test_template"]
	elif payload.get("healthcare_service"):
		filters["healthcare_service"] = payload["healthcare_service"]
	elif payload.get("item_code"):
		filters["item_code"] = payload["item_code"]
	else:
		return ""

	existing = frappe.db.get_value("Insurance History Prices", filters, "name")
	if existing:
		doc = frappe.get_doc("Insurance History Prices", existing)
		for key, value in payload.items():
			if value is not None:
				doc.set(key, value)
		doc.save(ignore_permissions=True)
		return existing

	doc = frappe.get_doc({"doctype": "Insurance History Prices", **payload})
	doc.insert(ignore_permissions=True)
	return doc.name


def _row_identity(row: dict) -> tuple | None:
	if row.get("lab_test_template"):
		return ("lab", row["lab_test_template"], row.get("service_type") or "")
	if row.get("healthcare_service"):
		return ("svc", row["healthcare_service"], row.get("service_type") or "")
	if row.get("item_code"):
		return ("item", row["item_code"], row.get("service_type") or "")
	return None


def _merge_priced_rows(doc, parsed_rows: list[dict]) -> tuple[int, int]:
	existing: dict[tuple, int] = {}
	existing_by_item: dict[tuple[str, str], int] = {}
	for idx, row in enumerate(doc.get("inclusive_item") or []):
		identity = _row_identity(
			{
				"lab_test_template": row.lab_test_template,
				"healthcare_service": row.healthcare_service,
				"item_code": row.item_code,
				"service_type": row.service_type,
			}
		)
		if identity:
			existing[identity] = idx
		if row.item_code:
			existing_by_item[(row.item_code, row.service_type or "")] = idx

	added = updated = 0
	price_fields = (
		"price",
		"from_date",
		"to_date",
		"outpatient_discount",
		"inpatient_discount",
		"discount_apply",
		"service_type",
		"lab_test_template",
		"lab_test_name",
		"healthcare_service",
		"healthcare_service_name",
		"item_code",
		"item_name",
	)

	for payload in parsed_rows:
		identity = _row_identity(payload)
		child_idx = existing.get(identity) if identity else None
		if child_idx is None and payload.get("item_code"):
			child_idx = existing_by_item.get((payload["item_code"], payload.get("service_type") or ""))
			if child_idx is None:
				# fallback: same item without service_type when only one row exists
				loose = [
					i
					for (code, stype), i in existing_by_item.items()
					if code == payload["item_code"]
				]
				if len(loose) == 1:
					child_idx = loose[0]

		if child_idx is not None:
			child = doc.inclusive_item[child_idx]
			for key in price_fields:
				if key in payload and payload[key] is not None:
					child.set(key, payload[key])
			if identity:
				existing[identity] = child_idx
			updated += 1
		else:
			doc.append("inclusive_item", payload)
			new_idx = len(doc.inclusive_item) - 1
			if identity:
				existing[identity] = new_idx
			if payload.get("item_code"):
				existing_by_item[(payload["item_code"], payload.get("service_type") or "")] = new_idx
			added += 1

	return added, updated


def _base_row(
	*,
	lab_test_template: str | None = None,
	lab_test_name: str | None = None,
	healthcare_service: str | None = None,
	healthcare_service_name: str | None = None,
	item_code: str | None = None,
	price: float | None = None,
	from_date: date | None = None,
	to_date: date | None = None,
	outpatient_discount: float | None = None,
	inpatient_discount: float | None = None,
	discount_apply: int = 0,
	service_type: str | None = None,
) -> dict:
	return {
		"lab_test_template": lab_test_template,
		"lab_test_name": lab_test_name,
		"healthcare_service": healthcare_service,
		"healthcare_service_name": healthcare_service_name,
		"item_code": item_code,
		"item_name": _item_name(item_code),
		"price": price,
		"from_date": from_date,
		"to_date": to_date,
		"outpatient_discount": outpatient_discount,
		"inpatient_discount": inpatient_discount,
		"discount_apply": cint(discount_apply),
		"service_type": service_type or "",
	}


def _lab_discount_for_source(source: Any, ip_disc_cell: Any, op_disc_cell: Any) -> tuple[float | None, float | None, int]:
	"""Lab June-16 list: 1% IP / 6% OP when discount applies; Outsource N/A → blank."""
	src = str(source or "").strip().lower()

	# Outsource rows often say "Discount not applicable"
	if src.startswith("out") and not _has_discount(ip_disc_cell, op_disc_cell):
		return None, None, 0

	if _has_discount(ip_disc_cell, op_disc_cell) or src.startswith("in") or not src:
		return LAB_IP_PCT, LAB_OP_PCT, 1

	return None, None, 0


def _service_discounts(service_type: str, period_pct: float | None = None) -> tuple[float | None, float | None, int]:
	"""Return (inpatient_discount, outpatient_discount, discount_apply) for a service type.

	- IP: same % on both channels (new period 3%).
	- OP: outpatient %; inpatient explicitly 0%.
	- IOP: no discount — both channels explicitly 0%.
	"""
	stype = (service_type or "").upper()
	if stype == "IP":
		pct = flt(period_pct) if period_pct is not None else IP_SERVICE_DISC_PCT
		if pct > 0:
			return pct, pct, 1
		return 0.0, 0.0, 0
	if stype == "OP":
		pct = flt(period_pct) if period_pct is not None else OP_SERVICE_DISC_PCT
		if pct > 0:
			return 0.0, pct, 1
		return 0.0, 0.0, 0
	if stype == "IOP":
		return 0.0, 0.0, 0
	return None, None, 0


def _lab_template(
	test_code,
	test_name,
	index,
	*,
	rate=None,
	created=None,
	create_missing=True,
):
	if create_missing:
		return _get_or_create_lab_template(test_code, test_name, index, rate=rate, created=created)
	return _resolve_lab_template(test_code, test_name, index)


def _service_template(
	*,
	service_code=None,
	service_name=None,
	index=None,
	rate=None,
	category="Medical Service",
	created=None,
	create_missing=True,
):
	if create_missing:
		return _get_or_create_service_template(
			service_code=service_code,
			service_name=service_name,
			index=index,
			rate=rate,
			category=category,
			created=created,
		)
	return _resolve_service_template(service_code=service_code, service_name=service_name, index=index)


def parse_lab_prices(
	file_url: str, created: dict | None = None, create_missing: bool = True
) -> tuple[list[dict], list[dict], list[str]]:
	"""Lab file is June-16-effective only → current inclusive rows; no history periods."""
	wb = _load_workbook(file_url)
	lab_index = _build_lab_template_index()
	current: list[dict] = []
	missing: list[str] = []
	from_date, to_date = _default_new_dates()

	for sheet_name in wb.sheetnames:
		ws = wb[sheet_name]
		sheet_header = _resolve_lab_sheet_header(ws)
		if not sheet_header:
			continue

		for raw in ws.iter_rows(values_only=True):
			if not raw:
				continue
			cells = list(raw)
			if _find_lab_header(cells):
				continue

			test_code = cells[sheet_header["test_code"]] if len(cells) > sheet_header["test_code"] else None
			test_name = cells[sheet_header["test_name"]] if len(cells) > sheet_header["test_name"] else None
			if not _is_lab_test_code(test_code):
				continue

			test_code = str(test_code).strip()
			rate = None
			if sheet_header.get("test_price", -1) >= 0 and len(cells) > sheet_header["test_price"]:
				rate = cells[sheet_header["test_price"]]
			price = _parse_price(rate)
			if price is None:
				continue

			template = _lab_template(
				test_code, test_name, lab_index, rate=rate, created=created, create_missing=create_missing
			)
			if not template:
				missing.append(f"Lab: {test_code} — {test_name or ''}".strip())
				continue

			source = cells[5] if len(cells) > 5 else None
			ip_cell = (
				cells[sheet_header["ip_disc"]]
				if sheet_header.get("ip_disc", -1) >= 0 and len(cells) > sheet_header["ip_disc"]
				else None
			)
			op_cell = (
				cells[sheet_header["op_disc"]]
				if sheet_header.get("op_disc", -1) >= 0 and len(cells) > sheet_header["op_disc"]
				else None
			)
			ip_pct, op_pct, discount_apply = _lab_discount_for_source(source, ip_cell, op_cell)

			current.append(
				_base_row(
					lab_test_template=template["name"],
					lab_test_name=template.get("lab_test_name") or str(test_name or "").strip() or None,
					item_code=template.get("item_code"),
					price=price,
					from_date=from_date,
					to_date=to_date,
					inpatient_discount=ip_pct,
					outpatient_discount=op_pct,
					discount_apply=discount_apply,
					service_type="",
				)
			)

	wb.close()
	return current, [], missing


def _detect_amount_periods(ws, code_header_aliases: set[str]) -> list[dict]:
	"""Find period amount columns from header rows containing Effective… labels."""
	header_row_idx = None
	period_labels_row = None
	header_cells: list[Any] = []

	for idx, raw in enumerate(ws.iter_rows(max_row=20, values_only=True), start=1):
		if not raw:
			continue
		cells = list(raw)
		first = _norm_header_cell(cells[0] if cells else "")
		joined = " ".join(_norm_header_cell(c) for c in cells[:4])
		if first in code_header_aliases or any(a in joined for a in code_header_aliases):
			header_row_idx = idx
			header_cells = cells
			break
		# keep scanning for Effective labels above the header
		for cell in cells:
			if cell and "effective" in str(cell).lower():
				period_labels_row = cells

	if header_row_idx is None:
		return []

	# Also look one/two rows above header for period labels
	if period_labels_row is None:
		for offset in (1, 2, 3):
			if header_row_idx - offset < 1:
				break
			row = None
			for i, raw in enumerate(ws.iter_rows(max_row=header_row_idx, values_only=True), start=1):
				if i == header_row_idx - offset:
					row = list(raw)
					break
			if row and any(c and "effective" in str(c).lower() for c in row):
				period_labels_row = row
				break

	periods: list[dict] = []
	for col_idx, label in enumerate(header_cells):
		norm = _norm_header_cell(label)
		if not norm:
			continue
		is_amount = (
			norm in ("amount (bhd)", "amount", "gross amount (bhd)", "gross amount", "test price (bhd)", "test price")
			or ("amount" in norm and "net" not in norm and "discount" not in norm)
			or ("gross" in norm and "amount" in norm)
		)
		if not is_amount:
			continue

		period_label = ""
		if period_labels_row and col_idx < len(period_labels_row):
			# walk left for nearest Effective label
			for look in range(col_idx, -1, -1):
				candidate = period_labels_row[look]
				if candidate and "effective" in str(candidate).lower():
					period_label = str(candidate).strip()
					break

		from_date, to_date = _parse_effective_dates(period_label)
		disc_pct = None
		# adjacent discount column often follows amount
		if col_idx + 1 < len(header_cells):
			disc_pct = _parse_percent_from_header(header_cells[col_idx + 1])

		periods.append(
			{
				"amount_col": col_idx,
				"label": period_label,
				"from_date": from_date,
				"to_date": to_date,
				"discount_pct": disc_pct,
				"is_new": _is_new_period(from_date, to_date, period_label),
			}
		)

	# No Effective labels → cannot tell new vs old; leave as history (not current).
	if periods and not any(p["label"] for p in periods):
		for p in periods:
			p["is_new"] = False

	# Multiple amounts without parsed dates: last column is newest (June 16 files).
	elif periods and not any(p.get("from_date") for p in periods):
		for i, p in enumerate(periods):
			p["is_new"] = i == len(periods) - 1
			if p["is_new"]:
				p["from_date"], p["to_date"] = _default_new_dates()
			else:
				p["to_date"] = NEW_FROM - timedelta(days=1)

	# Fill open-ended older periods up to the day before the next period.
	dated = sorted(
		[p for p in periods if p.get("from_date")],
		key=lambda p: p["from_date"],
	)
	for i, p in enumerate(dated):
		if p.get("to_date"):
			continue
		if i + 1 < len(dated) and dated[i + 1].get("from_date"):
			p["to_date"] = dated[i + 1]["from_date"] - timedelta(days=1)
		elif p.get("is_new"):
			p["to_date"] = NEW_TO

	return periods


def _resolve_op_service(
	out_name: Any,
	service_code: Any,
	index: dict,
	created: dict | None = None,
	rate: Any = None,
	create_missing: bool = True,
) -> dict | None:
	"""Match OP by system code, OUT name, OP-{OUT}, or suffix (…-ECG)."""
	code = (str(service_code or "")).strip()
	out = (str(out_name or "")).strip()

	candidates = []
	if code:
		candidates.append(code)
	if out:
		candidates.extend([out, f"OP-{out}", f"OP {out}"])
		# OP-CONSULTATION - 30MINS style variants
		dashed = re.sub(r"\s+", "-", out)
		candidates.append(dashed)
		candidates.append(f"OP-{dashed}")

	for candidate in candidates:
		found = _resolve_service_template(service_code=candidate, service_name=candidate, index=index)
		if found:
			return found
		found = _resolve_service_template(service_name=candidate, index=index)
		if found:
			return found

	# Suffix match on index: OUT name is the trailing service token (ECG ↔ OP-ECG)
	out_key = _norm_name(out)
	if out_key:
		for name_key, payload in index["by_name"].items():
			if name_key == out_key or name_key.endswith(" " + out_key) or name_key.endswith("-" + out_key):
				return payload
			# OP-ECG / IP-ECG style ids
		for id_key, payload in index["by_id"].items():
			if id_key == out_key or id_key.endswith("-" + out_key) or id_key.endswith(out_key):
				# Prefer OP- prefixed when matching OP file
				if id_key.startswith("OP-") or id_key == f"OP{out_key}" or id_key.endswith("-" + out_key):
					return payload
		# second pass any suffix
		for id_key, payload in index["by_id"].items():
			if id_key.endswith("-" + out_key) or id_key.endswith(out_key):
				return payload

	# Create from OP system code when present
	create_name = code or (f"OP-{out}" if out else None)
	if create_name and create_missing:
		return _service_template(
			service_code=create_name if code else None,
			service_name=create_name if not code else (code if code.startswith("OP") else f"OP-{out}"),
			index=index,
			rate=rate,
			category="Other Service",
			created=created,
			create_missing=True,
		)
	return None


def _iop_lookup_name(iop_column: Any) -> str | None:
	"""Build service name from IOP column: MEDICAL REPORT → IOP-MEDICAL REPORT."""
	short = (str(iop_column or "")).strip()
	if not short:
		return None
	if _norm_name(short).startswith("IOP"):
		# Already IOP-EEG / IOP EEG → normalize to IOP-…
		text = re.sub(r"(?i)^IOP[\s\-]+", "IOP-", short).strip()
		return text or short
	return f"IOP-{short}"


def _resolve_iop_service(
	service_name: Any,
	iop_short: Any,
	index: dict,
	created: dict | None = None,
	rate: Any = None,
	create_missing: bool = True,
) -> dict | None:
	"""Match Healthcare Service Template via IOP column → IOP-{column} service name/id."""
	lookup = _iop_lookup_name(iop_short) or _iop_lookup_name(service_name)
	if not lookup:
		return None

	candidates = [lookup]
	# Also try without forcing prefix variants from raw column / first column
	for value in (iop_short, service_name):
		text = (str(value or "")).strip()
		if text and text not in candidates:
			candidates.append(text)

	for candidate in candidates:
		# Prefer service_name, then service_id / name
		found = _resolve_service_template(service_name=candidate, index=index)
		if found:
			return found
		found = _resolve_service_template(service_code=candidate, index=index)
		if found:
			return found

	lookup_key = _norm_name(lookup)
	if lookup_key:
		if lookup_key in index["by_name"]:
			return index["by_name"][lookup_key]
		if lookup_key in index["by_id"]:
			return index["by_id"][lookup_key]
		# Tolerate IOP MEDICAL REPORT vs IOP-MEDICAL REPORT
		alt = lookup_key.replace("IOP ", "IOP-")
		if alt in index["by_name"]:
			return index["by_name"][alt]
		if alt in index["by_id"]:
			return index["by_id"][alt]

	if create_missing:
		return _service_template(
			service_name=lookup,
			service_code=lookup,
			index=index,
			rate=rate,
			category="Other Service",
			created=created,
			create_missing=True,
		)
	return None


def parse_ip_prices(
	file_url: str, created: dict | None = None, create_missing: bool = True
) -> tuple[list[dict], list[dict], list[str]]:
	wb = _load_workbook(file_url)
	service_index = _build_service_index()
	current: list[dict] = []
	history: list[dict] = []
	missing: list[str] = []
	seen_current: set[str] = set()

	for sheet_name in wb.sheetnames:
		ws = wb[sheet_name]
		periods = _detect_amount_periods(ws, {"services code", "service code"})
		# Sheets with no June-16 "new" period → history only (e.g. additional IP sheet).
		if not periods or not any(p.get("is_new") for p in periods):
			current_rows, hist_rows, miss = _parse_simple_ip_sheet(
				ws, service_index, created, create_missing=create_missing
			)
			current.extend(current_rows)
			history.extend(hist_rows)
			missing.extend(miss)
			continue

		header_found = False
		for raw in ws.iter_rows(values_only=True):
			if not _is_data_row(raw):
				continue
			cells = list(raw)
			if _norm_header_cell(cells[0] if cells else "") == "services code":
				header_found = True
				continue
			if not header_found:
				continue

			service_code = cells[0] if len(cells) > 0 else None
			service_name = cells[1] if len(cells) > 1 else None
			if not _is_ip_service_code(service_code):
				continue

			# Prefer new-period amount for template rate
			new_rate = None
			for period in periods:
				if period["is_new"] and len(cells) > period["amount_col"]:
					new_rate = cells[period["amount_col"]]
					break
			if new_rate is None and periods:
				last = periods[-1]
				if len(cells) > last["amount_col"]:
					new_rate = cells[last["amount_col"]]

			template = _service_template(
				service_code=service_code,
				service_name=service_name,
				index=service_index,
				rate=new_rate,
				created=created,
				create_missing=create_missing,
			)
			if not template:
				missing.append(f"IP service: {service_code} — {service_name or ''}".strip())
				continue

			for period in periods:
				if len(cells) <= period["amount_col"]:
					continue
				price = _parse_price(cells[period["amount_col"]])
				if price is None:
					continue

				from_date = period.get("from_date")
				to_date = period.get("to_date")
				# New IP period → 3% on both; older periods use header % on both channels.
				disc = IP_SERVICE_DISC_PCT if period["is_new"] else period.get("discount_pct")
				ip_pct, op_pct, discount_apply = _service_discounts("IP", disc)

				row = _base_row(
					healthcare_service=template["name"],
					healthcare_service_name=template.get("service_name")
					or str(service_name or "").strip()
					or None,
					item_code=template.get("item_code"),
					price=price,
					from_date=from_date or (NEW_FROM if period["is_new"] else None),
					to_date=to_date or (NEW_TO if period["is_new"] else None),
					inpatient_discount=ip_pct,
					outpatient_discount=op_pct,
					discount_apply=discount_apply,
					service_type="IP",
				)

				if period["is_new"]:
					code_key = _norm_code(service_code)
					if code_key not in seen_current:
						if not row["from_date"]:
							row["from_date"], row["to_date"] = _default_new_dates()
						current.append(row)
						seen_current.add(code_key)
				else:
					history.append(row)

	wb.close()
	return current, history, missing


def _parse_simple_ip_sheet(
	ws, service_index, created, create_missing: bool = True
) -> tuple[list[dict], list[dict], list[str]]:
	"""Handle 'IP Price List-new additional' style single-period sheets as history."""
	current: list[dict] = []
	history: list[dict] = []
	missing: list[str] = []
	header_found = False

	for raw in ws.iter_rows(values_only=True):
		if not _is_data_row(raw):
			continue
		cells = list(raw)
		if str(cells[0] or "").strip() == "Services Code":
			header_found = True
			continue
		if not header_found:
			continue

		service_code = cells[0] if len(cells) > 0 else None
		service_name = cells[1] if len(cells) > 1 else None
		if not _is_ip_service_code(service_code):
			continue

		rate = cells[2] if len(cells) > 2 else None
		price = _parse_price(rate)
		if price is None:
			continue

		template = _service_template(
			service_code=service_code,
			service_name=service_name,
			index=service_index,
			rate=rate,
			created=created,
			create_missing=create_missing,
		)
		if not template:
			missing.append(f"IP service: {service_code} — {service_name or ''}".strip())
			continue

		disc_col = cells[3] if len(cells) > 3 else None
		remarks = str(cells[5] if len(cells) > 5 else "")
		# Remarks often say Effective from November 2021 → history
		from_date, to_date = _parse_effective_dates(remarks.replace("from", "").strip())
		if not from_date and "2021" in remarks:
			from_date = date(2021, 11, 1)
			to_date = NEW_FROM - timedelta(days=1)

		# Legacy additional sheet uses 6% when a discount amount is present.
		ip_pct, op_pct, discount_apply = _service_discounts(
			"IP", 6.0 if _has_discount(disc_col) else 0.0
		)

		row = _base_row(
			healthcare_service=template["name"],
			healthcare_service_name=template.get("service_name") or str(service_name or "").strip() or None,
			item_code=template.get("item_code"),
			price=price,
			from_date=from_date,
			to_date=to_date,
			inpatient_discount=ip_pct,
			outpatient_discount=op_pct,
			discount_apply=discount_apply,
			service_type="IP",
		)
		# Single-period legacy sheet → history only (main sheet carries June 16 prices)
		history.append(row)

	return current, history, missing


def parse_iop_prices(
	file_url: str, created: dict | None = None, create_missing: bool = True
) -> tuple[list[dict], list[dict], list[str]]:
	wb = _load_workbook(file_url)
	service_index = _build_service_index()
	current: list[dict] = []
	history: list[dict] = []
	missing: list[str] = []
	seen: set[str] = set()

	for sheet_name in wb.sheetnames:
		ws = wb[sheet_name]
		# IOP layout: Service Name | IOP | ENTRY | old Amount | new Amount
		old_from, old_to = date(2023, 4, 1), date(2026, 6, 15)
		new_from, new_to = _default_new_dates()

		# refine dates from Effective labels if present
		for raw in ws.iter_rows(max_row=12, values_only=True):
			if not raw:
				continue
			cells = list(raw)
			for col_idx, cell in enumerate(cells):
				if not cell or "effective" not in str(cell).lower():
					continue
				start, end = _parse_effective_dates(cell)
				if _is_new_period(start, end, str(cell)):
					new_from = start or new_from
					new_to = end or new_to
				elif start:
					old_from = start
					old_to = end or (NEW_FROM - timedelta(days=1))

		header_found = False
		for raw in ws.iter_rows(values_only=True):
			if not _is_data_row(raw):
				continue
			cells = list(raw)
			first = str(cells[0] or "").strip()
			if first == "Service Name":
				header_found = True
				continue
			if not header_found:
				continue

			# Col A = Service Name (label), Col B = IOP short name used for lookup
			service_name = cells[0] if len(cells) > 0 else None
			iop_short = cells[1] if len(cells) > 1 else None
			if not iop_short and not service_name:
				continue
			# Skip lab-tests discount instruction rows / actual charges
			name_u = str(iop_short or service_name or "").upper()
			if "LAB TEST" in name_u or name_u.startswith("ALL ITEMS"):
				continue

			old_amount = cells[3] if len(cells) > 3 else None
			new_amount = cells[4] if len(cells) > 4 else None
			new_price = _parse_price(new_amount)
			old_price = _parse_price(old_amount)

			# Skip non-priced rows (ACTUAL CHARGES, text discounts)
			if new_price is None and old_price is None:
				continue

			# Lookup key: IOP column → IOP-MEDICAL REPORT (service name / id)
			template = _resolve_iop_service(
				service_name,
				iop_short,
				service_index,
				created=created,
				rate=new_amount or old_amount,
				create_missing=create_missing,
			)
			if not template:
				missing.append(
					f"IOP service: {_iop_lookup_name(iop_short) or service_name}"
				)
				continue

			key = template["name"]
			# IOP has no discount % — set both channels to 0 (Discount Apply off).
			ip_pct, op_pct, discount_apply = _service_discounts("IOP")
			lookup_label = _iop_lookup_name(iop_short) or str(service_name or "").strip()
			base_kwargs = dict(
				healthcare_service=template["name"],
				healthcare_service_name=template.get("service_name") or lookup_label,
				item_code=template.get("item_code"),
				inpatient_discount=ip_pct,
				outpatient_discount=op_pct,
				discount_apply=discount_apply,
				service_type="IOP",
			)

			if old_price is not None:
				history.append(
					_base_row(
						**base_kwargs,
						price=old_price,
						from_date=old_from,
						to_date=old_to,
					)
				)

			if new_price is not None and key not in seen:
				current.append(
					_base_row(
						**base_kwargs,
						price=new_price,
						from_date=new_from,
						to_date=new_to,
					)
				)
				seen.add(key)

	wb.close()
	return current, history, missing


def parse_op_prices(
	file_url: str, created: dict | None = None, create_missing: bool = True
) -> tuple[list[dict], list[dict], list[str]]:
	wb = _load_workbook(file_url)
	service_index = _build_service_index()
	current: list[dict] = []
	history: list[dict] = []
	missing: list[str] = []
	seen: set[str] = set()

	for sheet_name in wb.sheetnames:
		ws = wb[sheet_name]
		periods = _detect_amount_periods(ws, {"services-system", "services system", "service name"})
		if not periods:
			continue

		# Find data start: row after SERVICES-SYSTEM header (and OUT/MILITARY subheaders)
		header_found = False
		for raw in ws.iter_rows(values_only=True):
			if not raw:
				continue
			cells = list(raw)
			first = _norm_header_cell(cells[0] if cells else "")
			second = _norm_header_cell(cells[1] if len(cells) > 1 else "")
			if first in ("services-system", "services system") or second == "out":
				header_found = True
				# skip INSURANCE / MILITARY banner rows
				continue
			if not header_found:
				continue

			# skip banner rows
			joined = " ".join(str(c or "") for c in cells[:4]).upper()
			if "INSURANCE" in joined or joined.strip() in ("MILITARY", "OUT"):
				continue

			service_code = cells[0] if len(cells) > 0 else None
			out_name = cells[1] if len(cells) > 1 else None
			if not out_name and not service_code:
				continue
			code_text = str(service_code or "").strip()
			if code_text and not code_text.upper().startswith("OP") and not out_name:
				continue
			# Require either OP- code or OUT name with some amount
			if code_text.upper() in ("SERVICES-SYSTEM", "SERVICE NAME"):
				continue

			new_rate = None
			for period in periods:
				if period["is_new"] and len(cells) > period["amount_col"]:
					new_rate = cells[period["amount_col"]]
					break

			template = _resolve_op_service(
				out_name,
				service_code,
				service_index,
				created=created,
				rate=new_rate,
				create_missing=create_missing,
			)
			if not template:
				missing.append(f"OP service: {service_code or ''} — {out_name or ''}".strip(" —"))
				continue

			for period in periods:
				if len(cells) <= period["amount_col"]:
					continue
				price = _parse_price(cells[period["amount_col"]])
				if price is None:
					continue

				# New OP period → 20% outpatient / 0% inpatient; older periods use header %.
				disc = OP_SERVICE_DISC_PCT if period["is_new"] else period.get("discount_pct")
				ip_pct, op_pct, discount_apply = _service_discounts("OP", disc)
				from_date = period.get("from_date")
				to_date = period.get("to_date")

				row = _base_row(
					healthcare_service=template["name"],
					healthcare_service_name=template.get("service_name")
					or str(out_name or service_code or "").strip()
					or None,
					item_code=template.get("item_code"),
					price=price,
					from_date=from_date or (NEW_FROM if period["is_new"] else None),
					to_date=to_date or (NEW_TO if period["is_new"] else None),
					outpatient_discount=op_pct,
					inpatient_discount=ip_pct,
					discount_apply=discount_apply,
					service_type="OP",
				)

				if period["is_new"]:
					key = template["name"]
					if key not in seen:
						if not row["from_date"]:
							row["from_date"], row["to_date"] = _default_new_dates()
						current.append(row)
						seen.add(key)
				else:
					history.append(row)

	wb.close()
	return current, history, missing


def _resolve_health_insurance(health_insurance: str | None = None) -> str:
	"""Use the opened Health Insurance when given; otherwise ensure TRICARE exists."""
	name = (health_insurance or "").strip()
	if name:
		if not frappe.db.exists("Health Insurance", name):
			frappe.throw(_("Health Insurance {0} was not found.").format(name))
		return name
	return _ensure_tricare()


@frappe.whitelist()
def preview_tricare_price_update(
	lab_file_url: str | None = None,
	ip_file_url: str | None = None,
	iop_file_url: str | None = None,
	op_file_url: str | None = None,
	health_insurance: str | None = None,
):
	"""Dry-run parse counts for the Healthcare Settings / Health Insurance confirm dialog."""
	if not any([lab_file_url, ip_file_url, iop_file_url, op_file_url]):
		frappe.throw(_("Upload at least one TRICARE price list Excel file."))

	insurance_name = _resolve_health_insurance(health_insurance)
	summary = {
		"lab_current": 0,
		"ip_current": 0,
		"iop_current": 0,
		"op_current": 0,
		"history_rows": 0,
		"missing_count": 0,
		"missing_sample": [],
	}
	missing: list[str] = []

	parsers = [
		("lab", lab_file_url, parse_lab_prices, "lab_current"),
		("ip", ip_file_url, parse_ip_prices, "ip_current"),
		("iop", iop_file_url, parse_iop_prices, "iop_current"),
		("op", op_file_url, parse_op_prices, "op_current"),
	]
	for _kind, url, parser, key in parsers:
		if not url:
			continue
		current, history, miss = parser(url, create_missing=False)
		summary[key] = len(current)
		summary["history_rows"] += len(history)
		missing.extend(miss)

	summary["missing_count"] = len(missing)
	summary["missing_sample"] = missing[:30]
	summary["insurance"] = insurance_name
	summary["new_from"] = str(NEW_FROM)
	summary["new_to"] = str(NEW_TO)
	return summary


@frappe.whitelist()
def update_tricare_prices_from_excel(
	lab_file_url: str | None = None,
	ip_file_url: str | None = None,
	iop_file_url: str | None = None,
	op_file_url: str | None = None,
	health_insurance: str | None = None,
):
	"""Apply June 16 2026 prices to Health Insurance inclusive items; archive older Excel prices."""
	if not any([lab_file_url, ip_file_url, iop_file_url, op_file_url]):
		frappe.throw(_("Upload at least one TRICARE price list Excel file."))

	insurance_name = _resolve_health_insurance(health_insurance)
	doc = frappe.get_doc("Health Insurance", insurance_name)

	all_current: list[dict] = []
	all_history: list[dict] = []
	missing: list[str] = []
	created = {"lab_templates": 0, "service_templates": 0}
	summary = {"lab": 0, "ip": 0, "iop": 0, "op": 0}

	if lab_file_url:
		rows, hist, miss = parse_lab_prices(lab_file_url, created=created)
		all_current.extend(rows)
		all_history.extend(hist)
		missing.extend(miss)
		summary["lab"] = len(rows)

	if ip_file_url:
		rows, hist, miss = parse_ip_prices(ip_file_url, created=created)
		all_current.extend(rows)
		all_history.extend(hist)
		missing.extend(miss)
		summary["ip"] = len(rows)

	if iop_file_url:
		rows, hist, miss = parse_iop_prices(iop_file_url, created=created)
		all_current.extend(rows)
		all_history.extend(hist)
		missing.extend(miss)
		summary["iop"] = len(rows)

	if op_file_url:
		rows, hist, miss = parse_op_prices(op_file_url, created=created)
		all_current.extend(rows)
		all_history.extend(hist)
		missing.extend(miss)
		summary["op"] = len(rows)

	if not all_current and not all_history:
		frappe.throw(_("No priced rows were found in the uploaded files."))

	added, updated = (0, 0)
	if all_current:
		added, updated = _merge_priced_rows(doc, all_current)
		doc.save(ignore_permissions=True)

	history_created = 0
	history_updated = 0
	for row in all_history:
		payload = {
			"health_insurance": insurance_name,
			**{k: v for k, v in row.items() if v is not None},
		}
		# Normalize dates for storage
		if payload.get("from_date"):
			payload["from_date"] = getdate(payload["from_date"])
		if payload.get("to_date"):
			payload["to_date"] = getdate(payload["to_date"])

		filters = {
			"health_insurance": insurance_name,
			"from_date": payload.get("from_date"),
			"to_date": payload.get("to_date"),
		}
		if payload.get("lab_test_template"):
			filters["lab_test_template"] = payload["lab_test_template"]
		elif payload.get("healthcare_service"):
			filters["healthcare_service"] = payload["healthcare_service"]
		elif payload.get("item_code"):
			filters["item_code"] = payload["item_code"]

		existed = bool(frappe.db.exists("Insurance History Prices", filters))
		_upsert_history(payload)
		if existed:
			history_updated += 1
		else:
			history_created += 1

	message = _(
		"Insurance prices updated for {10}. Inclusive items: {0} added, {1} updated "
		"(lab {2}, IP {3}, IOP {4}, OP {5}). "
		"History: {6} created, {7} updated. "
		"Templates created: {8} lab, {9} service."
	).format(
		added,
		updated,
		summary["lab"],
		summary["ip"],
		summary["iop"],
		summary["op"],
		history_created,
		history_updated,
		created.get("lab_templates", 0),
		created.get("service_templates", 0),
		insurance_name,
	)

	return {
		"ok": True,
		"message": message,
		"summary": summary,
		"added": added,
		"updated": updated,
		"history_created": history_created,
		"history_updated": history_updated,
		"created": created,
		"missing_count": len(missing),
		"missing_sample": missing[:40],
		"insurance": insurance_name,
	}
