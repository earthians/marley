import json
import frappe
from frappe import _
from frappe.utils import nowdate, nowtime, now_datetime, cint, cstr, flt, getdate, formatdate
from healthcare.api.utils.api_utility import get_next_transaction_number
from healthcare.healthcare.care_episode_guard import assert_inpatient_admission_open_for_create
from healthcare.healthcare.editing_lock import assert_editing_allowed


def _medicine_given_has_column(column: str) -> bool:
	return frappe.db.has_column("Medicine Given", column)


def _medicine_given_list_fields() -> list[str]:
	"""Return Medicine Given fields that exist in the database (safe before migrate)."""
	fields = [
		"name",
		"date",
		"time",
		"medicine_code",
		"medicine_name",
		"medication_order",
		"medicine_given_timing",
	]
	if _medicine_given_has_column("dose"):
		fields.append("dose")
	fields.extend(
		[
			"qty",
			"unit",
			"frequency",
			"dose_notes",
			"user",
			"is_prn",
			"prescription_type",
			"sales_order",
			"delivery_note",
			"batch_no",
			"lot_no",
			"dispensing_lot",
			"override_exceeded_frequency",
		]
	)
	if _medicine_given_has_column("override_exceeded_dose_limit"):
		fields.append("override_exceeded_dose_limit")
	if _medicine_given_has_column("override_exceeded_cumulative_24h"):
		fields.append("override_exceeded_cumulative_24h")
	fields.extend(
		[
			"override_reason",
			"override_user",
			"override_timestamp",
			"old_medicine_code",
			"old_medicine_name",
			"ip_admission_medicine",
			"ip_admission_medicine_sheet",
			"patient_medication_order",
			"modified",
		]
	)
	return fields


def _set_medicine_given_dose(row, dose_text: str) -> None:
	if _medicine_given_has_column("dose"):
		row.dose = dose_text


def _get_or_create_admission_detail(admission: str):
	"""Return Admission Detail doc for an Inpatient Admission, creating it if missing."""
	if not admission:
		frappe.throw(_("Admission is required"))

	admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
	if admission_detail_name:
		return frappe.get_doc("Admission Detail", admission_detail_name)

	# Create a new Admission Detail and satisfy mandatory fields
	admission_doc = frappe.get_doc("Inpatient Admission", admission)

	doc = frappe.new_doc("Admission Detail")
	doc.admission = admission
	# Mandatory fields on Admission Detail
	if hasattr(doc, "file_no"):
		doc.file_no = admission_doc.patient
	if hasattr(doc, "patient_name"):
		doc.patient_name = admission_doc.patient_name

	doc.insert(ignore_permissions=True)
	return doc


def _safe_time_text(value) -> str:
	if not value:
		return ""
	return str(value).strip()


def _normalize_row_time(value=None) -> str:
	"""Return HH:MM:SS without date or microsecond noise for Medicine Given.time."""
	if value is None:
		return now_datetime().strftime("%H:%M:%S")

	raw = _safe_time_text(value)
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


def _time_to_minutes(value) -> int:
	t = _safe_time_text(value)
	if not t:
		return -1
	parts = t.split(":")
	if len(parts) < 2:
		return -1
	try:
		hh = int(parts[0])
		mm = int(parts[1])
	except Exception:
		return -1
	return hh * 60 + mm


def _date_in_range(target_date, start_date=None, end_date=None) -> bool:
	if not target_date:
		return False
	d = getdate(target_date)
	if start_date and d < getdate(start_date):
		return False
	if end_date and d > getdate(end_date):
		return False
	return True


def _entry_is_long_acting_medicine(entry) -> bool:
	"""Long-acting lines are given via Long Acting Medicine listing, not Record Given Medicine."""
	if cint(entry.get("is_long_acting_medicine")):
		return True
	return cstr(entry.get("medication_type") or "").strip() == "Long Acting Medicine"


def _medicine_cannot_be_given_reason(entry, given_date=None, parent_end_date=None):
	"""Why this prescription line cannot be recorded as given, or None if allowed."""
	if entry is None:
		return None
	status = cstr(entry.get("medication_status") or "").strip()
	if status == "On Hold":
		return _("This medicine is On Hold by the doctor and cannot be given until it is continued.")
	if status == "Discontinued":
		return _("This medicine has been discontinued by the doctor and cannot be given.")
	if cint(entry.get("stopped")) or cstr(entry.get("reason_stopped") or "").strip():
		return _("This medicine has been stopped and cannot be given.")
	if _entry_is_long_acting_medicine(entry):
		return _("Long acting medicines must be recorded from the Long Acting Medicine listing.")
	end = entry.get("end_date") or parent_end_date
	when = given_date or nowdate()
	if end and getdate(when) > getdate(end):
		return _("This medicine ended on {0} and cannot be given.").format(formatdate(getdate(end)))
	return None


def is_daily_prescription_frequency(freq_name: str | None) -> bool:
	"""True when Prescription Frequency is marked Daily (morning/noon/evening automation)."""
	freq_name = (freq_name or "").strip()
	if not freq_name or not frappe.db.exists("Prescription Frequency", freq_name):
		return False
	if not frappe.db.has_column("Prescription Frequency", "daily"):
		return False
	return cint(frappe.db.get_value("Prescription Frequency", freq_name, "daily")) == 1


def _daily_frequency_schedule_times(freq_name: str | None) -> list[str]:
	"""Scheduled administration times for a daily prescription frequency."""
	if not is_daily_prescription_frequency(freq_name):
		return []

	times: list[str] = []
	try:
		doc = frappe.get_doc("Prescription Frequency", freq_name)
		for child in getattr(doc, "dosage_strength", []) or []:
			strength_time = _safe_time_text(getattr(child, "strength_time", None))
			if strength_time and strength_time not in times:
				times.append(strength_time)
	except frappe.DoesNotExistError:
		pass
	return times


def _has_given_for_scheduled_slot(admission_detail_name: str, date_value, medicine_code: str, medication_order: str, scheduled_time: str) -> bool:
	"""Return True if there is already a given row for this medicine slot.

	Primary match: medicine_given_timing == scheduled_time.
	Fallback match: same hour in `time` when medicine_given_timing is empty.
	"""
	if not admission_detail_name or not medicine_code:
		return False

	filters = {
		"parent": admission_detail_name,
		"parenttype": "Admission Detail",
		"date": getdate(date_value),
		"medicine_code": medicine_code,
	}
	if medication_order:
		filters["medication_order"] = medication_order

	given_rows = frappe.get_all(
		"Medicine Given",
		filters=filters,
		fields=["name", "time", "medicine_given_timing"],
		ignore_permissions=True,
	)
	if not given_rows:
		return False

	scheduled_minutes = _time_to_minutes(scheduled_time)
	for row in given_rows:
		given_timing = _safe_time_text(row.get("medicine_given_timing"))
		if given_timing and scheduled_time and given_timing == scheduled_time:
			return True

		# Backward compatibility: legacy rows did not set medicine_given_timing.
		row_minutes = _time_to_minutes(row.get("time"))
		if row_minutes >= 0 and scheduled_minutes >= 0 and (row_minutes // 60) == (scheduled_minutes // 60):
			return True

	return False


def _has_missed_row_for_slot(admission_detail_name: str, date_value, medicine_code: str, medication_order: str, scheduled_time: str) -> bool:
	filters = {
		"parent": admission_detail_name,
		"parenttype": "Admission Detail",
		"date": getdate(date_value),
		"medicine_code": medicine_code,
		"medicine_given_timing": scheduled_time,
	}
	if medication_order:
		filters["medication_order"] = medication_order
	return bool(frappe.db.exists("Missed Medicine", filters))


def _create_missed_row(
	admission_detail,
	*,
	date_value,
	scheduled_time: str,
	medicine_code: str,
	medicine_name: str | None,
	medication_order: str | None,
	qty,
	unit,
	frequency,
	is_prn,
):
	row = admission_detail.append("missed_medicine", {})
	row.date = getdate(date_value)
	row.time = nowtime()
	row.medicine_code = medicine_code
	if hasattr(row, "medicine_name"):
		row.medicine_name = medicine_name or frappe.db.get_value("Item", medicine_code, "item_name")
	row.medication_order = medication_order
	row.qty = qty or 1
	row.unit = unit or frappe.db.get_value("Item", medicine_code, "stock_uom")
	row.frequency = frequency
	row.medicine_given_timing = scheduled_time
	row.user = frappe.session.user
	if hasattr(row, "is_prn"):
		row.is_prn = cint(is_prn)
	row.dose_notes = (
		f"Missed auto-detected by scheduler. Scheduled at {scheduled_time}. "
		f"Created on {now_datetime().strftime('%Y-%m-%d %H:%M:%S')}."
	)


def _prescription_type_from_order_entry(
	order_entry_name: str | None = None,
	pmo=None,
	drug_code: str | None = None,
) -> str | None:
	"""Map prescription line medication_type to Medicine Given.prescription_type."""
	medication_type = None
	if order_entry_name:
		medication_type = frappe.db.get_value(
			"Inpatient Medication Order Entry",
			order_entry_name,
			"medication_type",
		)
	elif pmo and drug_code:
		for entry in pmo.medication_orders or []:
			if entry.drug == drug_code:
				medication_type = getattr(entry, "medication_type", None)
				break
	elif pmo and getattr(pmo, "medication_orders", None):
		medication_type = getattr(pmo.medication_orders[0], "medication_type", None)

	return (medication_type or "").strip() or None


def _prescription_type_for_medication_order(medication_order: str | None, drug_code: str | None) -> str | None:
	if not medication_order or not drug_code:
		return None
	rows = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters={"parent": medication_order, "drug": drug_code},
		fields=["medication_type"],
		order_by="modified desc, creation desc",
		limit=1,
		ignore_permissions=True,
	)
	if not rows:
		return None
	return (rows[0].get("medication_type") or "").strip() or None


def _set_medicine_given_prescription_type(row, prescription_type: str | None) -> None:
	if hasattr(row, "prescription_type") and prescription_type:
		row.prescription_type = prescription_type


def _warehouse_for_admission(admission: str) -> str | None:
	cost_center = frappe.db.get_value("Inpatient Admission", admission, "cost_center")
	if not cost_center:
		return None
	from healthcare.api.common import get_warehouse_for_cost_center

	return get_warehouse_for_cost_center(cost_center)


def _resolve_stock_warehouse(admission: str, warehouse: str | None = None) -> str | None:
	wh = (warehouse or "").strip() or None
	if wh:
		return wh
	return _warehouse_for_admission(admission)


def _item_tracking_flags(item_code: str) -> tuple[bool, bool]:
	if not item_code:
		return False, False
	row = frappe.db.get_value("Item", item_code, ["has_batch_no", "has_serial_no"], as_dict=True)
	if not row:
		return False, False
	return bool(cint(row.has_batch_no)), bool(cint(row.has_serial_no))


def _item_requires_dispensing_lot(item_code: str) -> bool:
	if not item_code or not frappe.db.has_column("Item", "custom_has_dispense_lot"):
		return False
	return bool(cint(frappe.db.get_value("Item", item_code, "custom_has_dispense_lot") or 0))


def display_batch_and_lot_on_pharmacy_giveout() -> bool:
	"""When enabled, pharmacy give-out UI requires nurses to pick batch / dispensing lot."""
	try:
		return bool(
			cint(
				frappe.get_cached_value(
					"Healthcare Settings",
					"Healthcare Settings",
					"display_batch_and_lot_on_pharmacy_giveout",
				)
			)
		)
	except Exception:
		return False


def _sort_batches_fifo(batches: list[dict]) -> list[dict]:
	from datetime import date as date_type

	def _as_date(value):
		if not value:
			return None
		if isinstance(value, date_type):
			return value
		try:
			return getdate(value)
		except Exception:
			return None

	def sort_key(batch: dict):
		expiry = _as_date(batch.get("expiry_date")) or date_type.max
		manufacturing = _as_date(batch.get("manufacturing_date")) or date_type.max
		label = (batch.get("batch_id") or batch.get("batch_name") or "").strip()
		return (expiry, manufacturing, label)

	return sorted(batches, key=sort_key)


def auto_resolve_medicine_given_batch_lot(
	item_code: str,
	admission: str | None = None,
	batch_no: str | None = None,
	lot_no: str | None = None,
	dispensing_lot: str | None = None,
	warehouse: str | None = None,
) -> tuple[str | None, str | None, str | None]:
	"""Auto-pick FIFO batch, dispensing lot, or serial when pharmacy give-out hides manual pickers."""
	warehouse = _resolve_stock_warehouse(admission, warehouse)
	requires_dispensing_lot = _item_requires_dispensing_lot(item_code)
	has_batch, has_serial = _item_tracking_flags(item_code)
	if not requires_dispensing_lot and not has_batch and not has_serial:
		return None, None, None

	resolved_batch = (batch_no or "").strip() or None
	resolved_lot = (lot_no or "").strip() or None
	resolved_dispensing = (dispensing_lot or "").strip() or None

	if (requires_dispensing_lot or has_batch) and not resolved_batch and warehouse:
		from healthcare.api.nursing_inventory import get_item_batches

		batches = _sort_batches_fifo(get_item_batches(item_code, warehouse) or [])
		if batches:
			first = batches[0]
			resolved_batch = (first.get("batch_name") or first.get("batch_id") or "").strip() or None

	if requires_dispensing_lot and not resolved_dispensing:
		lots = _get_dispensing_lots_for_item(item_code, warehouse, resolved_batch, fifo=True)
		if lots:
			resolved_dispensing = lots[0].get("name")

	if has_serial and not requires_dispensing_lot and not resolved_lot and warehouse:
		from healthcare.api.nursing_inventory import get_batch_details_with_serials, get_item_serials

		serials: list[str] = []
		if resolved_batch:
			rows = get_batch_details_with_serials(resolved_batch, warehouse) or []
			serials = [r.get("serial_no") for r in rows if r.get("serial_no")]
		else:
			serials = get_item_serials(item_code, warehouse) or []
		if serials:
			resolved_lot = serials[0]

	return resolved_batch, resolved_lot, resolved_dispensing


def allocate_dispensing_lots_for_qty(
	item_code: str,
	warehouse: str | None,
	qty: float,
	batch_no: str | None = None,
	preferred_dispensing_lot: str | None = None,
) -> list[dict]:
	"""FIFO-allocate qty across one or more Dispensing Lots (open next lot when short).

	Returns a list of ``{batch_no, dispensing_lot, qty}`` covering ``qty`` in the lot UOM
	(typically UNIT). Used by pharmacy give-out so a 6-UNIT issue can take 4 from lot A
	and 2 from lot B instead of failing on the first lot.
	"""
	needed = flt(qty)
	if needed <= 0:
		return []

	if not _item_requires_dispensing_lot(item_code):
		return [
			{
				"batch_no": (batch_no or "").strip() or None,
				"dispensing_lot": None,
				"qty": needed,
			}
		]

	warehouse = (warehouse or "").strip() or None
	preferred = (preferred_dispensing_lot or "").strip() or None
	# Prefer lots on the selected batch first, then any other open lots for the item.
	lots = _get_dispensing_lots_for_item(item_code, warehouse, batch_no, fifo=True)
	if batch_no:
		extra = _get_dispensing_lots_for_item(item_code, warehouse, None, fifo=True)
		seen = {(l.get("name") or "").strip() for l in lots}
		for lot in extra:
			name = (lot.get("name") or "").strip()
			if name and name not in seen:
				lots.append(lot)
				seen.add(name)

	if preferred:
		preferred_rows = [l for l in lots if (l.get("name") or "").strip() == preferred]
		other_rows = [l for l in lots if (l.get("name") or "").strip() != preferred]
		if not preferred_rows and frappe.db.exists("Dispensing Lot", preferred):
			lot_doc = frappe.db.get_value(
				"Dispensing Lot",
				preferred,
				["name", "remaining_qty", "batch_no", "uom", "serial_no"],
				as_dict=True,
			)
			if lot_doc and flt(lot_doc.remaining_qty) > 0:
				preferred_rows = [
					{
						"name": lot_doc.name,
						"remaining_qty": flt(lot_doc.remaining_qty),
						"batch_no": lot_doc.batch_no,
						"uom": lot_doc.uom,
					}
				]
		lots = preferred_rows + other_rows

	allocations: list[dict] = []
	remaining = needed
	uom_label = ""

	for lot in lots:
		if remaining <= 0:
			break
		lot_name = (lot.get("name") or "").strip()
		lot_remaining = flt(lot.get("remaining_qty"))
		if not lot_name or lot_remaining <= 0:
			continue
		take = min(remaining, lot_remaining)
		if take <= 0:
			continue
		allocations.append(
			{
				"batch_no": (lot.get("batch_no") or batch_no or "").strip() or None,
				"dispensing_lot": lot_name,
				"qty": take,
			}
		)
		uom_label = (lot.get("uom") or uom_label or "").strip()
		remaining = flt(remaining - take)

	if remaining > 0:
		available = needed - remaining
		frappe.throw(
			_(
				"Insufficient dispensing lot quantity for {0}. Need {1}{2}, available {3}{2}. "
				"Open or receive more dispensing lots at this warehouse."
			).format(
				item_code,
				needed,
				f" {uom_label}" if uom_label else "",
				available,
			)
		)

	return allocations


def format_dispensing_lot_field(lot_names: list[str] | None) -> str | None:
	"""Join multiple Dispensing Lot names for custom_dispensing_lot (newline-separated)."""
	clean = []
	seen = set()
	for name in lot_names or []:
		token = (name or "").strip()
		if token and token not in seen:
			clean.append(token)
			seen.add(token)
	if not clean:
		return None
	return "\n".join(clean) if len(clean) > 1 else clean[0]


def _resolve_batch_no_for_dispensing_lot_filter(batch_no: str, item_code: str | None = None) -> list[str]:
	"""Return Batch doc name / batch_id variants for filtering Dispensing Lot.batch_no."""
	batch_no = (batch_no or "").strip()
	if not batch_no:
		return []

	values = {batch_no}

	if frappe.db.exists("Batch", batch_no):
		batch_id = frappe.db.get_value("Batch", batch_no, "batch_id")
		if batch_id:
			values.add((batch_id or "").strip())

	filters: dict = {"batch_id": batch_no}
	if item_code:
		filters["item"] = item_code
	for name in frappe.get_all("Batch", filters=filters, pluck="name") or []:
		if name:
			values.add(name)

	if item_code:
		for name in frappe.get_all("Batch", filters={"item": item_code, "name": batch_no}, pluck="name") or []:
			if name:
				values.add(name)

	return [v for v in values if v]


def _get_dispensing_lots_for_item(
	item_code: str, warehouse: str | None, batch_no: str | None = None, *, fifo: bool = False
) -> list[dict]:
	if not item_code or not frappe.db.exists("DocType", "Dispensing Lot"):
		return []

	filters = {
		"item": item_code,
		"status": ["in", ["Active", "Partially Sold"]],
		"remaining_qty": [">", 0],
	}
	if warehouse:
		filters["warehouse"] = warehouse
	if batch_no:
		batch_values = _resolve_batch_no_for_dispensing_lot_filter(batch_no, item_code)
		if len(batch_values) == 1:
			filters["batch_no"] = batch_values[0]
		elif batch_values:
			filters["batch_no"] = ["in", batch_values]

	rows = frappe.get_all(
		"Dispensing Lot",
		filters=filters,
		fields=[
			"name",
			"serial_no",
			"remaining_qty",
			"initial_qty",
			"uom",
			"stock_uom",
			"batch_no",
			"creation",
		],
		order_by="creation asc, name asc" if fifo else "modified desc",
		limit=500,
	)
	result = []
	for lot in rows:
		remaining = flt(lot.remaining_qty)
		initial = flt(lot.initial_qty)
		serial = (lot.serial_no or lot.name or "").strip()
		uom = lot.uom or ""
		label = f"{remaining:g} {uom} | {serial}" if uom else serial
		result.append(
			{
				"name": lot.name,
				"serial_no": serial,
				"remaining_qty": remaining,
				"initial_qty": initial,
				"uom": uom,
				"stock_uom": lot.stock_uom,
				"batch_no": lot.batch_no,
				"label": label,
			}
		)
	return result


def _validate_medicine_given_batch_lot(
	item_code: str,
	admission: str,
	batch_no: str | None,
	lot_no: str | None,
	dispensing_lot: str | None = None,
	warehouse: str | None = None,
) -> None:
	"""Validate provided batch / lot values. Missing values are allowed (auto-resolve may fill them)."""
	requires_dispensing_lot = _item_requires_dispensing_lot(item_code)
	has_batch, has_serial = _item_tracking_flags(item_code)
	if not requires_dispensing_lot and not has_batch and not has_serial:
		return

	warehouse = _resolve_stock_warehouse(admission, warehouse)
	batch_no = (batch_no or "").strip() or None
	lot_no = (lot_no or "").strip() or None
	dispensing_lot = (dispensing_lot or "").strip() or None

	if requires_dispensing_lot:
		if dispensing_lot:
			if not frappe.db.exists("Dispensing Lot", dispensing_lot):
				frappe.throw(_("Dispensing Lot {0} does not exist").format(dispensing_lot))
			lot_item = frappe.db.get_value("Dispensing Lot", dispensing_lot, "item")
			if lot_item and lot_item != item_code:
				frappe.throw(_("Dispensing Lot {0} does not belong to item {1}").format(dispensing_lot, item_code))
			if batch_no:
				lot_batch = frappe.db.get_value("Dispensing Lot", dispensing_lot, "batch_no")
				if lot_batch:
					allowed_batches = set(_resolve_batch_no_for_dispensing_lot_filter(batch_no, item_code))
					if lot_batch not in allowed_batches:
						frappe.throw(_("Dispensing Lot {0} does not belong to batch {1}").format(dispensing_lot, batch_no))
		if batch_no:
			if not frappe.db.exists("Batch", batch_no):
				frappe.throw(_("Batch {0} does not exist").format(batch_no))
			batch_item = frappe.db.get_value("Batch", batch_no, "item")
			if batch_item and batch_item != item_code:
				frappe.throw(_("Batch {0} does not belong to item {1}").format(batch_no, item_code))
		return

	if batch_no:
		if not frappe.db.exists("Batch", batch_no):
			frappe.throw(_("Batch {0} does not exist").format(batch_no))
		batch_item = frappe.db.get_value("Batch", batch_no, "item")
		if batch_item and batch_item != item_code:
			frappe.throw(_("Batch {0} does not belong to item {1}").format(batch_no, item_code))

	# Lot / serial integrity is checked only when a value is provided.
	if has_serial and warehouse and lot_no:
		from healthcare.api.nursing_inventory import get_batch_details_with_serials, get_item_serials

		available_lots = []
		if batch_no:
			rows = get_batch_details_with_serials(batch_no, warehouse) or []
			available_lots = [r.get("serial_no") for r in rows if r.get("serial_no")]
		else:
			available_lots = get_item_serials(item_code, warehouse) or []

		if available_lots and lot_no not in available_lots:
			frappe.throw(_("Lot {0} is not available for this medicine at the warehouse.").format(lot_no))


def _resolve_and_validate_medicine_given_batch_lot(
	item_code: str,
	admission: str,
	batch_no: str | None = None,
	lot_no: str | None = None,
	dispensing_lot: str | None = None,
	warehouse: str | None = None,
) -> tuple[str | None, str | None, str | None]:
	"""FIFO-fill missing batch / lot, then validate any provided or resolved values."""
	warehouse = _resolve_stock_warehouse(admission, warehouse)
	resolved_batch, resolved_lot, resolved_dispensing = auto_resolve_medicine_given_batch_lot(
		item_code,
		admission,
		batch_no=batch_no,
		lot_no=lot_no,
		dispensing_lot=dispensing_lot,
		warehouse=warehouse,
	)
	_validate_medicine_given_batch_lot(
		item_code,
		admission,
		resolved_batch,
		resolved_lot,
		resolved_dispensing,
		warehouse=warehouse,
	)
	return resolved_batch, resolved_lot, resolved_dispensing


def _apply_medicine_given_batch_lot(
	row,
	batch_no: str | None,
	lot_no: str | None,
	dispensing_lot: str | None = None,
) -> None:
	batch_no = (batch_no or "").strip() or None
	lot_no = (lot_no or "").strip() or None
	dispensing_lot = (dispensing_lot or "").strip() or None
	if hasattr(row, "batch_no") and batch_no:
		row.batch_no = batch_no
	if hasattr(row, "dispensing_lot") and dispensing_lot:
		row.dispensing_lot = dispensing_lot
		if not lot_no:
			lot_no = frappe.db.get_value("Dispensing Lot", dispensing_lot, "serial_no") or dispensing_lot
	if hasattr(row, "lot_no") and lot_no:
		row.lot_no = lot_no


@frappe.whitelist()
def get_medicine_given_stock_options(admission: str = None, item_code: str = None, warehouse: str | None = None) -> dict:
	"""Return warehouse, batch list, and whether lots (serials) apply for given medicine.

	Admission resolves the warehouse when none is given; an explicit warehouse
	(e.g. OP pharmacy give-out) works without an admission.
	"""
	if not admission and not warehouse:
		frappe.throw(_("Admission or warehouse is required"))
	if not item_code:
		frappe.throw(_("Item code is required"))

	item_code = item_code.strip()
	has_batch, has_serial = _item_tracking_flags(item_code)
	requires_dispensing_lot = _item_requires_dispensing_lot(item_code)
	warehouse = _resolve_stock_warehouse(admission, warehouse)

	batches = []
	if has_batch and warehouse:
		from healthcare.api.nursing_inventory import get_item_batches

		batches = _sort_batches_fifo(get_item_batches(item_code, warehouse) or [])

	dispensing_lots = []
	if requires_dispensing_lot:
		dispensing_lots = _get_dispensing_lots_for_item(item_code, warehouse)

	return {
		"warehouse": warehouse or "",
		"has_batch_no": has_batch,
		"has_serial_no": has_serial,
		"requires_dispensing_lot": requires_dispensing_lot,
		"batches": batches,
		"dispensing_lots": dispensing_lots,
	}


@frappe.whitelist()
def get_medicine_given_dispensing_lots(
	admission: str,
	item_code: str,
	batch_no: str | None = None,
	warehouse: str | None = None,
) -> list[dict]:
	"""Dispensing lots for an item at the admission warehouse (optionally filtered by batch).

	An explicit warehouse (e.g. OP pharmacy give-out) works without an admission.
	"""
	if (not admission and not warehouse) or not item_code:
		return []
	return _get_dispensing_lots_for_item(
		item_code.strip(),
		_resolve_stock_warehouse(admission, warehouse),
		(batch_no or "").strip() or None,
	)


@frappe.whitelist()
def get_medicine_given_lots(batch_no: str, admission: str) -> list[dict]:
	"""Return lot numbers (serials) available for a batch at the admission warehouse."""
	batch_no = (batch_no or "").strip()
	if not batch_no or not admission:
		return []

	warehouse = _warehouse_for_admission(admission)
	if not warehouse:
		return []

	from healthcare.api.nursing_inventory import get_batch_details_with_serials

	rows = get_batch_details_with_serials(batch_no, warehouse) or []
	return [{"lot_no": r.get("serial_no"), "qty": r.get("qty")} for r in rows if r.get("serial_no")]


@frappe.whitelist()
def get_medicine_given_item_lots(admission: str, item_code: str) -> list[str]:
	"""Return lot numbers for serial-tracked items without batch selection."""
	item_code = (item_code or "").strip()
	if not item_code or not admission:
		return []

	has_batch, has_serial = _item_tracking_flags(item_code)
	if not has_serial or has_batch:
		return []

	warehouse = _warehouse_for_admission(admission)
	if not warehouse:
		return []

	from healthcare.api.nursing_inventory import get_item_serials

	return get_item_serials(item_code, warehouse) or []


def _get_latest_active_inpatient_medication_order(admission: str) -> str | None:
	"""Return latest submitted inpatient PMO for this admission that allows medicine giving.

	Skips cancelled and Nursing Pharmacy Give Out (sold) orders.
	"""
	from healthcare.healthcare.doctype.patient_medication_order.patient_medication_order import (
		PatientMedicationOrder,
	)

	filters = {"inpatient_record": admission, "docstatus": 1, "status": ["!=", "Cancelled"]}
	pmo_meta = frappe.get_meta("Patient Medication Order")
	if pmo_meta.has_field("nursing_pharmacy_giveout"):
		filters["nursing_pharmacy_giveout"] = ["!=", 1]
	if pmo_meta.has_field("is_pharmacy_give_out"):
		filters["is_pharmacy_give_out"] = ["!=", 1]

	rows = frappe.get_all(
		"Patient Medication Order",
		filters=filters,
		fields=["name"],
		order_by="modified desc, creation desc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	for row in rows:
		doc = frappe.get_doc("Patient Medication Order", row.name)
		if PatientMedicationOrder.allows_medicine_giving(doc):
			return row.name
	return None


def _create_missed_medicine_for_admission(admission_name: str, grace_minutes: int = 60) -> int:
	"""Create missed rows for one admission. Returns number of created rows."""
	today = getdate(nowdate())
	now_minutes = _time_to_minutes(nowtime())
	if now_minutes < 0:
		return 0

	admission_detail = _get_or_create_admission_detail(admission_name)

	# Ensure we only check the latest prescription linked to the current inpatient admission.
	latest_pmo = _get_latest_active_inpatient_medication_order(admission_name)
	if not latest_pmo:
		return 0

	entry_filters = {"parent": latest_pmo}
	# Do not create missed entries for stopped medicines.
	if frappe.db.has_column("Inpatient Medication Order Entry", "stopped"):
		entry_filters["stopped"] = ["in", [0, ""]]
	if frappe.db.has_column("Inpatient Medication Order Entry", "reason_stopped"):
		entry_filters["reason_stopped"] = ["in", ["", None]]
	if frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
		entry_filters["transferred_to_visit"] = ["is", "not set"]
	if frappe.db.has_column("Inpatient Medication Order Entry", "returned_to_store"):
		entry_filters["returned_to_store"] = ["in", [0, ""]]

	entries = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters=entry_filters,
		fields=[
			"name",
			"parent",
			"drug",
			"drug_name",
			"quantity",
			"uom",
			"date",
			"end_date",
			"time",
			"patient_frequency",
			"is_prn",
		],
		ignore_permissions=True,
	)

	created_rows = 0
	for e in entries:
		drug = e.get("drug")
		if not drug:
			continue
		if cint(e.get("is_prn")):
			continue
		if not is_daily_prescription_frequency(e.get("patient_frequency")):
			# Q3W, monthly, etc. — nurses record these manually; no auto missed rows.
			continue
		if not _date_in_range(today, e.get("date"), e.get("end_date")):
			continue

		scheduled_times = _daily_frequency_schedule_times(e.get("patient_frequency"))
		if not scheduled_times:
			entry_time = _safe_time_text(e.get("time"))
			if entry_time:
				scheduled_times = [entry_time]

		for scheduled_time in scheduled_times:
			scheduled_minutes = _time_to_minutes(scheduled_time)
			if scheduled_minutes < 0:
				continue
			if now_minutes < (scheduled_minutes + cint(grace_minutes)):
				continue

			if _has_given_for_scheduled_slot(
				admission_detail.name, today, drug, e.get("parent"), scheduled_time
			):
				continue
			if _has_missed_row_for_slot(
				admission_detail.name, today, drug, e.get("parent"), scheduled_time
			):
				continue

			_create_missed_row(
				admission_detail,
				date_value=today,
				scheduled_time=scheduled_time,
				medicine_code=drug,
				medicine_name=e.get("drug_name"),
				medication_order=e.get("parent"),
				qty=flt(e.get("quantity") or 1),
				unit=e.get("uom"),
				frequency=None,
				is_prn=e.get("is_prn"),
			)
			created_rows += 1

	if created_rows > 0:
		admission_detail.save(ignore_permissions=True)

	return created_rows


def create_missed_medicine_for_active_admissions(grace_minutes: int = 60) -> dict:
	"""Scheduler job: find missed due doses and write them to Admission Detail.missed_medicine.

	Run this every 2 hours via scheduler.
	"""
	active_admissions = frappe.get_all(
		"Inpatient Admission",
		filters={"status": ["in", ["Admitted", "Discharge Scheduled"]]},
		fields=["name"],
		ignore_permissions=True,
	)
	if not active_admissions:
		return {"processed_admissions": 0, "created_rows": 0}

	created_rows = 0
	for adm in active_admissions:
		created_rows += _create_missed_medicine_for_admission(adm.name, grace_minutes=cint(grace_minutes))

	return {"processed_admissions": len(active_admissions), "created_rows": created_rows}


@frappe.whitelist()
def check_missed_medicine_now(admission: str, grace_minutes: int = 60) -> dict:
	"""Manual trigger from UI for one admission."""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))
	created_rows = _create_missed_medicine_for_admission(admission, grace_minutes=cint(grace_minutes))
	return {"admission": admission, "created_rows": created_rows}


@frappe.whitelist()
def preview_medicine_given_dose_validation(
	admission: str,
	medicine_code: str,
	dose,
	date: str | None = None,
	time: str | None = None,
	route_of_administration: str | None = None,
	order_entry: str | None = None,
	medication_order: str | None = None,
) -> dict:
	"""Preview single-dose and 24-hour cumulative dose checks for Record Given."""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))
	if not medicine_code:
		frappe.throw(_("Medicine code is required"))
	if dose is None or str(dose).strip() == "":
		frappe.throw(_("Dose is required for dose-limit validation."))

	from healthcare.api.dose_limit_validation import (
		dose_limit_validation_message,
		evaluate_medicine_given_dose,
		extract_dose_numeric,
	)

	admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
	if not admission_detail_name:
		return {
			"ok": True,
			"has_limit": False,
			"message": "",
		}

	patient = frappe.db.get_value("Inpatient Admission", admission, "patient")
	from healthcare.api.dose_limit_validation import get_patient_weight_kg

	patient_weight = get_patient_weight_kg(patient=patient, admission=admission, inpatient_record=admission)
	if not (route_of_administration or "").strip() and order_entry:
		route_of_administration = frappe.db.get_value(
			"Inpatient Medication Order Entry", order_entry, "route_of_administration"
		)
	if not (route_of_administration or "").strip() and medication_order:
		route_of_administration = frappe.db.get_value(
			"Inpatient Medication Order Entry",
			{"parent": medication_order, "drug": medicine_code},
			"route_of_administration",
		)
	evaluation = evaluate_medicine_given_dose(
		admission_detail_name=admission_detail_name,
		medicine_code=medicine_code,
		dose=dose,
		date_value=date or nowdate(),
		time_value=time,
		patient_weight=patient_weight,
		patient=patient,
		admission=admission,
		route_of_administration=route_of_administration,
		order_entry=order_entry,
	)
	return {
		**evaluation,
		"parsed_dose": extract_dose_numeric(dose),
		"max_dose_per_single_dose": evaluation.get("max_dose_per_single_dose"),
		"max_dose_per_day": evaluation.get("max_dose_per_day"),
		"maximum_dose_limit": evaluation.get("maximum_dose_limit"),
		"message": dose_limit_validation_message(evaluation),
	}


@frappe.whitelist()
def create_medicine_given(
	admission: str,
	medication_order: str | None = None,
	order_entry: str | None = None,
	item_code: str | None = None,
	unit: str | None = None,
	dose: str | None = None,
	qty: float | int | None = None,
	date: str | None = None,
	time: str | None = None,
	frequency: int | None = None,
	dose_notes: str | None = None,
	allow_override: int | None = 0,
	override_reason: str | None = None,
	is_prn: int | None = 0,
	batch_no: str | None = None,
	lot_no: str | None = None,
	dispensing_lot: str | None = None,
) -> dict:
	"""Create a Medicine Given row on Admission Detail from a Patient Medication Order.

	This is used by Doctor / Nurse UI when recording each administration.
	"""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))

	assert_inpatient_admission_open_for_create(admission)

	if not medication_order and not item_code and not order_entry:
		frappe.throw(_("Either Patient Medication Order, medication line, or Item Code is required"))

	# Multiple current signed PMOs can exist on one admission. The UI lists all their
	# lines together, so always trust the selected line's parent prescription.
	if order_entry:
		child_parent = frappe.db.get_value("Inpatient Medication Order Entry", order_entry, "parent")
		if not child_parent:
			frappe.throw(_("Medication line {0} was not found.").format(frappe.bold(order_entry)))
		medication_order = child_parent

	pmo = None
	if medication_order:
		# Validate and fetch the medication order
		pmo = frappe.get_doc("Patient Medication Order", medication_order)

		if pmo.care_context != "Inpatient Admission" or not pmo.inpatient_record:
			frappe.throw(
				_("Patient Medication Order {0} is not linked to an Inpatient Admission.").format(
					frappe.bold(pmo.name)
				)
			)

		if pmo.inpatient_record != admission:
			frappe.throw(
				_(
					"Patient Medication Order {0} belongs to admission {1}, "
					"but you are recording medicine for admission {2}."
				).format(frappe.bold(pmo.name), frappe.bold(pmo.inpatient_record), frappe.bold(admission))
			)

		from healthcare.healthcare.doctype.patient_medication_order.patient_medication_order import (
			PatientMedicationOrder,
		)

		if not PatientMedicationOrder.allows_medicine_giving(pmo):
			frappe.throw(
				_(
					"Patient Medication Order {0} must be signed before medicine can be given."
				).format(frappe.bold(pmo.name))
			)

		# Block On Hold / Discontinued / Stopped, and lines whose end date has passed.
		_entry = None
		for _e in pmo.get("medication_orders") or []:
			if (order_entry and _e.name == order_entry) or (not order_entry and item_code and _e.drug == item_code):
				_entry = _e
				break
		blocked = _medicine_cannot_be_given_reason(
			_entry, given_date=date or nowdate(), parent_end_date=getattr(pmo, "end_date", None)
		)
		if blocked:
			frappe.throw(blocked)

	# Derive defaults: quantity is units given; dose is the clinical amount (e.g. 50mg).
	if qty is None:
		qty = 1

	parsed_qty = flt(qty)
	if parsed_qty <= 0:
		frappe.throw(_("Quantity must be greater than zero."))
	qty = parsed_qty

	dose_text = (dose or "").strip()

	# Resolve date / time defaults
	date = date or nowdate()
	time = _normalize_row_time(time)

	admission_detail = _get_or_create_admission_detail(admission)

	row = admission_detail.append("table_yrwe", {})
	row.date = date
	row.time = time
	_set_medicine_given_dose(row, dose_text)
	row.qty = qty
	row.unit = (unit or "").strip() or None
	row.frequency = frequency
	row.dose_notes = dose_notes
	row.medicine_given_timing = None
	row.user = frappe.session.user
	if hasattr(row, "is_prn"):
		row.is_prn = cint(is_prn)

	# Custom link field we added on Medicine Given child table
	if hasattr(row, "medication_order") and pmo:
		row.medication_order = pmo.name

	# Satisfy mandatory medicine fields using the selected medication order row
	if hasattr(row, "medicine_code"):
		drug_code = None
		drug_name = None
		prescription_frequency = None
		prescription_type = None
		given_route = None

		if item_code:
			drug_code = item_code
			drug_name = frappe.db.get_value("Item", item_code, "item_name")
		elif order_entry and pmo:
			child = frappe.get_doc("Inpatient Medication Order Entry", order_entry)
			drug_code = child.drug
			drug_name = child.drug_name
			given_route = getattr(child, "route_of_administration", None)
			prescription_frequency = child.patient_frequency or getattr(child, "long_acting_frequency", None)
			prescription_type = _prescription_type_from_order_entry(order_entry_name=order_entry)
			if not dose_text and getattr(child, "dosage", None):
				dose_text = (child.dosage or "").strip()
				_set_medicine_given_dose(row, dose_text)
			if hasattr(child, "uom") and not row.unit:
				row.unit = child.uom
			if hasattr(row, "is_prn") and not cint(is_prn):
				row.is_prn = cint(getattr(child, "is_prn", 0))
		elif pmo and getattr(pmo, "medication_orders", None):
			first = pmo.medication_orders[0]
			drug_code = getattr(first, "drug", None)
			drug_name = getattr(first, "drug_name", None)
			given_route = getattr(first, "route_of_administration", None)
			prescription_frequency = getattr(first, "patient_frequency", None)
			prescription_type = _prescription_type_from_order_entry(pmo=pmo, drug_code=drug_code)
			if not dose_text and getattr(first, "dosage", None):
				dose_text = (first.dosage or "").strip()
				_set_medicine_given_dose(row, dose_text)

		if not drug_code:
			frappe.throw(
				_(
					"Please select a medicine (either from prescription or direct item)."
				)
			)

		if not dose_text:
			frappe.throw(_("Dose is required (e.g. 50mg)."))

		from healthcare.api.dose_limit_validation import extract_dose_numeric

		if extract_dose_numeric(dose_text) is None:
			frappe.throw(_("Enter a valid dose (numeric value only, e.g. 50 or 50mg)."))
		_set_medicine_given_dose(row, dose_text)

		batch_no, lot_no, dispensing_lot = _resolve_and_validate_medicine_given_batch_lot(
			drug_code,
			admission,
			batch_no=batch_no,
			lot_no=lot_no,
			dispensing_lot=dispensing_lot,
		)

		row.medicine_code = drug_code
		if hasattr(row, "medicine_name"):
			row.medicine_name = drug_name or frappe.db.get_value("Item", drug_code, "item_name")

		_set_medicine_given_prescription_type(row, prescription_type)
		_apply_medicine_given_batch_lot(row, batch_no, lot_no, dispensing_lot)

		# Try to populate unit from Item stock_uom if present
		if hasattr(row, "unit") and not row.unit:
			stock_uom = frappe.db.get_value("Item", drug_code, "stock_uom")
			row.unit = stock_uom

		# Frequency-based maximum per day check — only for daily prescription frequencies.
		if prescription_frequency and is_daily_prescription_frequency(prescription_frequency):
			freq_per_day = frappe.db.get_value(
				"Prescription Frequency",
				prescription_frequency,
				"frequency_in_a_day",
			)
			freq_per_day = cint(freq_per_day or 0)
			if freq_per_day > 0:
				already_given = frappe.db.count(
					"Medicine Given",
					{
						"parent": admission_detail.name,
						"parenttype": "Admission Detail",
						"medicine_code": drug_code,
						"date": row.date,
					},
				)
				# This new row would be the (already_given + 1)-th administration today
				if already_given + 1 > freq_per_day:
					if not cint(allow_override):
						frappe.throw(
							_(
								"Frequency limit reached for this medicine.\n"
								"Prescribed frequency: {0} times per day.\n"
								"Already recorded doses today for this admission: {1}.\n"
								"Please review the prescription or consult the prescriber before giving an extra dose."
							).format(freq_per_day, already_given),
							title=_("Dose frequency exceeded"),
						)
					# Override allowed, but require a justification
					if not override_reason:
						frappe.throw(
							_("Override reason is required to exceed prescribed daily frequency."),
							title=_("Override reason required"),
						)
					# Record override audit fields on the row
					if hasattr(row, "override_exceeded_frequency"):
						row.override_exceeded_frequency = 1
					if hasattr(row, "override_reason"):
						row.override_reason = override_reason
					if hasattr(row, "override_user"):
						row.override_user = frappe.session.user
					if hasattr(row, "override_timestamp"):
						row.override_timestamp = now_datetime()

		from healthcare.api.dose_limit_validation import (
			apply_dose_limit_override_audit,
			validate_medicine_given_dose_or_throw,
		)

		dose_evaluation = validate_medicine_given_dose_or_throw(
			admission_detail_name=admission_detail.name,
			medicine_code=drug_code,
			dose=dose_text,
			date_value=row.date,
			time_value=row.time,
			allow_override=allow_override,
			override_reason=override_reason,
			admission=admission,
			patient=frappe.db.get_value("Inpatient Admission", admission, "patient"),
			route_of_administration=given_route,
			order_entry=order_entry,
		)
		if dose_evaluation.get("override_required"):
			apply_dose_limit_override_audit(row, dose_evaluation, (override_reason or "").strip())

	admission_detail.save()

	return {
		"admission_detail": admission_detail.name,
		"row_name": row.name,
	}


@frappe.whitelist()
def get_medicine_given(admission: str, limit: int | None = 50, offset: int | None = 0) -> list[dict]:
	"""Return Medicine Given rows for a specific Inpatient Admission (via Admission Detail)."""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))

	admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
	if not admission_detail_name:
		return []

	limit = cint(limit or 50)
	offset = cint(offset or 0)

	rows = frappe.get_all(
		"Medicine Given",
		filters={"parent": admission_detail_name, "parenttype": "Admission Detail"},
		fields=_medicine_given_list_fields(),
		order_by="date desc, time desc, modified desc",
		limit=limit,
		start=offset,
	)

	for row in rows:
		if row.get("time"):
			row["time"] = _normalize_row_time(row.get("time"))
		if row.get("batch_no"):
			row["batch_id"] = frappe.db.get_value("Batch", row["batch_no"], "batch_id") or row["batch_no"]
		# Legacy fallback for imported data where current medicine fields are empty.
		if not row.get("medicine_code") and row.get("old_medicine_code"):
			row["medicine_code"] = row.get("old_medicine_code")
		if not row.get("medicine_name") and row.get("old_medicine_name"):
			row["medicine_name"] = row.get("old_medicine_name")
		if row.get("ip_admission_medicine"):
			ip_med = frappe.db.get_value(
				"IP Admission Medicine",
				row["ip_admission_medicine"],
				["notes", "dose_note", "dose_notes", "trans_date", "trans_time", "start_date"],
				as_dict=True,
			) or {}
			if not row.get("dose_notes"):
				row["dose_notes"] = (
					(ip_med.get("dose_notes") or "").strip()
					or (ip_med.get("dose_note") or "").strip()
					or (ip_med.get("notes") or "").strip()
				)
			if not row.get("date"):
				row["date"] = ip_med.get("trans_date") or ip_med.get("start_date")
			if not row.get("time"):
				row["time"] = ip_med.get("trans_time")
		if row.get("ip_admission_medicine_sheet"):
			sheet = frappe.db.get_value(
				"IP Admission Medicine Sheet",
				row["ip_admission_medicine_sheet"],
				["given_date", "remarks"],
				as_dict=True,
			) or {}
			if not row.get("dose_notes") and sheet.get("remarks"):
				row["dose_notes"] = sheet.get("remarks")
			if not row.get("date") and sheet.get("given_date"):
				row["date"] = str(sheet["given_date"]).split(" ")[0]
			if not row.get("time") and sheet.get("given_date"):
				gd = str(sheet["given_date"])
				row["time"] = gd.split(" ")[1] if " " in gd else None

	return rows


@frappe.whitelist()
def get_missed_medicine(admission: str, limit: int | None = 50, offset: int | None = 0) -> list[dict]:
	"""Return Missed Medicine rows for a specific Inpatient Admission (via Admission Detail)."""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))

	admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
	if not admission_detail_name:
		return []

	limit = cint(limit or 50)
	offset = cint(offset or 0)

	rows = frappe.get_all(
		"Missed Medicine",
		filters={"parent": admission_detail_name, "parenttype": "Admission Detail"},
		fields=[
			"name",
			"date",
			"time",
			"medicine_code",
			"medicine_name",
			"medication_order",
			"qty",
			"unit",
			"medicine_given_timing",
			"dose_notes",
			"user",
			"old_medicine_code",
			"old_medicine_name",
			"ip_admission_medicine",
			"ip_admission_medicine_sheet",
			"patient_medication_order",
			"modified",
		],
		order_by="date desc, medicine_given_timing desc, modified desc",
		limit=limit,
		start=offset,
	)

	for row in rows:
		# Legacy fallback for imported data where current medicine fields are empty.
		if not row.get("medicine_code") and row.get("old_medicine_code"):
			row["medicine_code"] = row.get("old_medicine_code")
		if not row.get("medicine_name") and row.get("old_medicine_name"):
			row["medicine_name"] = row.get("old_medicine_name")
		if row.get("ip_admission_medicine"):
			ip_med = frappe.db.get_value(
				"IP Admission Medicine",
				row["ip_admission_medicine"],
				["notes", "dose_note", "dose_notes", "trans_date", "trans_time", "start_date", "frequency"],
				as_dict=True,
			) or {}
			if not row.get("dose_notes"):
				row["dose_notes"] = (
					(ip_med.get("dose_notes") or "").strip()
					or (ip_med.get("dose_note") or "").strip()
					or (ip_med.get("notes") or "").strip()
				)
			if not row.get("date"):
				row["date"] = ip_med.get("trans_date") or ip_med.get("start_date")
			if not row.get("time"):
				row["time"] = ip_med.get("trans_time")
			if not row.get("medicine_given_timing"):
				row["medicine_given_timing"] = ip_med.get("frequency")
		if row.get("ip_admission_medicine_sheet"):
			sheet = frappe.db.get_value(
				"IP Admission Medicine Sheet",
				row["ip_admission_medicine_sheet"],
				["given_date", "remarks"],
				as_dict=True,
			) or {}
			if not row.get("dose_notes") and sheet.get("remarks"):
				row["dose_notes"] = sheet.get("remarks")
			if not row.get("date") and sheet.get("given_date"):
				row["date"] = str(sheet["given_date"]).split(" ")[0]
			if not row.get("time") and sheet.get("given_date"):
				gd = str(sheet["given_date"])
				row["time"] = gd.split(" ")[1] if " " in gd else None
	return rows


@frappe.whitelist()
def convert_missed_medicine_to_given(name: str, given_late_reason: str | None = None) -> dict:
	"""Move one Missed Medicine row to Medicine Given and remove it from missed_medicine."""
	if not name:
		frappe.throw(_("Missed medicine row name is required"))

	missed = frappe.db.get_value(
		"Missed Medicine",
		name,
		["parenttype", "parent"],
		as_dict=True,
	)
	if not missed or not missed.get("parent"):
		frappe.throw(_("Missed medicine row not found"))
	if missed.get("parenttype") != "Admission Detail":
		frappe.throw(_("Missed medicine row is not linked to Admission Detail"))

	admission_detail = frappe.get_doc("Admission Detail", missed.parent)
	source = None
	for row in admission_detail.get("missed_medicine") or []:
		if row.name == name:
			source = row
			break
	if not source:
		frappe.throw(_("Missed medicine row not found in parent Admission Detail"))

	given = admission_detail.append("table_yrwe", {})
	given.date = source.date or getdate(nowdate())
	given.time = _normalize_row_time()
	given.medicine_code = source.medicine_code
	if hasattr(given, "medicine_name"):
		given.medicine_name = source.medicine_name
	if hasattr(given, "medication_order"):
		given.medication_order = source.medication_order
	given.qty = source.qty
	given.unit = source.unit
	given.frequency = source.frequency
	given.user = frappe.session.user
	given.medicine_given_timing = source.medicine_given_timing
	if hasattr(given, "is_prn"):
		given.is_prn = source.is_prn
	_set_medicine_given_prescription_type(
		given,
		_prescription_type_for_medication_order(source.medication_order, source.medicine_code),
	)

	notes = []
	if source.dose_notes:
		notes.append(f"Missed reason: {source.dose_notes}")
	if given_late_reason:
		notes.append(f"Given late reason: {given_late_reason}")
	notes.append(f"Converted from missed on {now_datetime().strftime('%Y-%m-%d %H:%M:%S')}")
	given.dose_notes = " | ".join(notes)

	# Remove from missed table in the same parent document transaction.
	remaining = [r for r in (admission_detail.get("missed_medicine") or []) if r.name != name]
	admission_detail.set("missed_medicine", remaining)
	admission_detail.save(ignore_permissions=True)

	return {
		"admission_detail": admission_detail.name,
		"given_row_name": given.name,
		"removed_missed_row_name": name,
	}


@frappe.whitelist()
def update_medicine_given(
	name: str,
	dose: str | None = None,
	qty: float | int | None = None,
	unit: str | None = None,
	date: str | None = None,
	time: str | None = None,
	dose_notes: str | None = None,
	allow_override: int | None = 0,
	override_reason: str | None = None,
	batch_no: str | None = None,
	lot_no: str | None = None,
	dispensing_lot: str | None = None,
) -> dict:
	"""Update an existing Medicine Given row on Admission Detail."""
	assert_editing_allowed()
	if not name:
		frappe.throw(_("Row name is required"))

	parenttype, parent = frappe.db.get_value(
		"Medicine Given", name, ["parenttype", "parent"], as_dict=False
	) or (None, None)
	if not parent or parenttype != "Admission Detail":
		frappe.throw(_("Medicine Given row {0} does not exist").format(frappe.bold(name)))

	sales_order = frappe.db.get_value("Medicine Given", name, "sales_order")
	if sales_order:
		frappe.throw(
			_("This given medicine is already linked to Sales Order {0} and cannot be edited.").format(
				frappe.bold(sales_order)
			)
		)

	admission_detail = frappe.get_doc("Admission Detail", parent)
	admission = admission_detail.admission
	if not admission:
		frappe.throw(_("Admission Detail is not linked to an Inpatient Admission"))

	assert_inpatient_admission_open_for_create(admission)

	row = next((r for r in admission_detail.table_yrwe if r.name == name), None)
	if not row:
		frappe.throw(_("Medicine Given row {0} was not found on Admission Detail").format(frappe.bold(name)))

	drug_code = row.medicine_code or row.old_medicine_code
	if not drug_code:
		frappe.throw(_("Medicine code is missing on this given medicine row"))

	dose_text = (dose if dose is not None else row.dose or "").strip()
	if not dose_text:
		frappe.throw(_("Dose is required (e.g. 50mg)."))

	from healthcare.api.dose_limit_validation import extract_dose_numeric

	if extract_dose_numeric(dose_text) is None:
		frappe.throw(_("Enter a valid dose (numeric value only, e.g. 50 or 50mg)."))

	parsed_qty = flt(qty if qty is not None else row.qty)
	if parsed_qty <= 0:
		frappe.throw(_("Quantity must be greater than zero."))

	row_date = date or row.date or nowdate()
	row_time = _normalize_row_time(time if time is not None else row.time)

	_batch_no, _lot_no, _dispensing_lot = _resolve_and_validate_medicine_given_batch_lot(
		drug_code,
		admission,
		batch_no=batch_no if batch_no is not None else row.batch_no,
		lot_no=lot_no if lot_no is not None else row.lot_no,
		dispensing_lot=dispensing_lot if dispensing_lot is not None else row.dispensing_lot,
	)
	batch_no = _batch_no
	lot_no = _lot_no
	dispensing_lot = _dispensing_lot

	prescription_frequency = None
	medication_order = row.medication_order or row.patient_medication_order
	if medication_order:
		pmo = frappe.get_doc("Patient Medication Order", medication_order)
		if getattr(pmo, "medication_orders", None):
			for child in pmo.medication_orders:
				if child.drug == drug_code:
					prescription_frequency = child.patient_frequency or getattr(
						child, "long_acting_frequency", None
					)
					break
			if not prescription_frequency and pmo.medication_orders:
				first = pmo.medication_orders[0]
				prescription_frequency = first.patient_frequency or getattr(
					first, "long_acting_frequency", None
				)

	if prescription_frequency and is_daily_prescription_frequency(prescription_frequency):
		freq_per_day = frappe.db.get_value(
			"Prescription Frequency",
			prescription_frequency,
			"frequency_in_a_day",
		)
		freq_per_day = cint(freq_per_day or 0)
		if freq_per_day > 0:
			already_given = frappe.db.count(
				"Medicine Given",
				{
					"parent": admission_detail.name,
					"parenttype": "Admission Detail",
					"medicine_code": drug_code,
					"date": row_date,
					"name": ["!=", name],
				},
			)
			if already_given + 1 > freq_per_day:
				if not cint(allow_override):
					frappe.throw(
						_(
							"Frequency limit reached for this medicine.\n"
							"Prescribed frequency: {0} times per day.\n"
							"Already recorded doses today for this admission: {1}.\n"
							"Please review the prescription or consult the prescriber before giving an extra dose."
						).format(freq_per_day, already_given),
						title=_("Dose frequency exceeded"),
					)
				if not override_reason:
					frappe.throw(
						_("Override reason is required to exceed prescribed daily frequency."),
						title=_("Override reason required"),
					)
				if hasattr(row, "override_exceeded_frequency"):
					row.override_exceeded_frequency = 1
				if hasattr(row, "override_reason"):
					row.override_reason = override_reason
				if hasattr(row, "override_user"):
					row.override_user = frappe.session.user
				if hasattr(row, "override_timestamp"):
					row.override_timestamp = now_datetime()

	from healthcare.api.dose_limit_validation import (
		apply_dose_limit_override_audit,
		validate_medicine_given_dose_or_throw,
	)

	dose_evaluation = validate_medicine_given_dose_or_throw(
		admission_detail_name=admission_detail.name,
		medicine_code=drug_code,
		dose=dose_text,
		date_value=row_date,
		time_value=row_time,
		allow_override=allow_override,
		override_reason=override_reason,
		exclude_row_name=name,
		admission=admission,
		patient=frappe.db.get_value("Inpatient Admission", admission, "patient"),
		route_of_administration=frappe.db.get_value(
			"Inpatient Medication Order Entry",
			{"parent": getattr(row, "medication_order", None), "drug": drug_code},
			"route_of_administration",
		)
		if getattr(row, "medication_order", None)
		else None,
		order_entry=getattr(row, "order_entry", None) or getattr(row, "medication_order_entry", None),
	)
	if dose_evaluation.get("override_required"):
		apply_dose_limit_override_audit(row, dose_evaluation, (override_reason or "").strip())

	row.date = row_date
	row.time = row_time
	_set_medicine_given_dose(row, dose_text)
	row.qty = parsed_qty
	if unit is not None:
		row.unit = (unit or "").strip() or None
	if dose_notes is not None:
		row.dose_notes = dose_notes
	_apply_medicine_given_batch_lot(row, batch_no, lot_no, dispensing_lot)

	admission_detail.save(ignore_permissions=True)

	return {
		"admission_detail": admission_detail.name,
		"row_name": row.name,
	}


@frappe.whitelist()
def delete_medicine_given(name: str) -> dict:
	"""Delete a Medicine Given row (child of Admission Detail)."""
	if not name:
		frappe.throw(_("Row name is required"))

	parenttype, parent = frappe.db.get_value(
		"Medicine Given", name, ["parenttype", "parent"], as_dict=False
	) or (None, None)

	if not parent:
		frappe.throw(_("Medicine Given row {0} does not exist").format(frappe.bold(name)))

	if parenttype != "Admission Detail":
		frappe.throw(_("Cannot delete Medicine Given row not linked to Admission Detail"))

	sales_order = frappe.db.get_value("Medicine Given", name, "sales_order")
	if sales_order:
		frappe.throw(
			_("This given medicine is already linked to Sales Order {0} and cannot be removed.").format(
				frappe.bold(sales_order)
			)
		)

	frappe.delete_doc("Medicine Given", name)

	return {"deleted": name}


@frappe.whitelist()
def reconcile_discharge_medicines(admission: str) -> dict:
	"""Compute remaining medicines for an admission and create a draft Stock Entry to return them.

	Remaining = total ordered (Patient Medication Order) - total given (Medicine Given).
	"""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))

	# Get all submitted medication orders for this admission
	order_names = frappe.get_all(
		"Patient Medication Order",
		filters={"inpatient_record": admission},
		pluck="name",
	)
	if not order_names:
		return {"stock_entry": None, "items": []}

	# Sum ordered quantity per drug from Inpatient Medication Order Entry
	ordered: dict[str, float] = {}
	order_rows = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters={"parent": ["in", order_names]},
		fields=["drug", "quantity"],
	)
	for row in order_rows:
		drug = row.get("drug")
		if not drug:
			continue
		qty = flt(row.get("quantity") or 0)
		if qty <= 0:
			continue
		ordered[drug] = ordered.get(drug, 0.0) + qty

	if not ordered:
		return {"stock_entry": None, "items": []}

	# Sum given quantity per drug from Medicine Given
	admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
	given: dict[str, float] = {}
	if admission_detail_name:
		given_rows = frappe.get_all(
			"Medicine Given",
			filters={"parent": admission_detail_name, "parenttype": "Admission Detail"},
			fields=["medicine_code", "qty"],
		)
		for row in given_rows:
			drug = row.get("medicine_code")
			if not drug:
				continue
			qty = flt(row.get("qty") or 0)
			if qty <= 0:
				continue
			given[drug] = given.get(drug, 0.0) + qty

	# Compute remaining quantities
	pending: dict[str, float] = {}
	for drug, total_ordered in ordered.items():
		total_given = given.get(drug, 0.0)
		remaining = flt(total_ordered) - flt(total_given)
		if remaining > 0:
			pending[drug] = remaining

	if not pending:
		return {"stock_entry": None, "items": []}

	# Create a draft Stock Entry (Material Receipt) back to the return warehouse
	warehouse, company = _get_return_warehouse_for_admission(admission)
	cost_center = _get_cost_center_for_admission(admission, company)

	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry.purpose = "Material Receipt"
	stock_entry.set_stock_entry_type()
	stock_entry.to_warehouse = warehouse
	stock_entry.company = company
	stock_entry.cost_center = cost_center

	items_summary: list[dict] = []

	for drug, qty in pending.items():
		item_row = stock_entry.append("items", {})
		item_row.item_code = drug
		item_row.item_name = frappe.db.get_value("Item", drug, "item_name") or drug
		item_row.uom = frappe.db.get_value("Item", drug, "stock_uom")
		item_row.stock_uom = item_row.uom
		item_row.t_warehouse = warehouse
		item_row.qty = qty
		item_row.conversion_factor = 1
		item_row.cost_center = cost_center

		items_summary.append({"item_code": drug, "qty": qty})

	stock_entry.insert(ignore_permissions=True)

	return {
		"stock_entry": stock_entry.name,
		"items": items_summary,
	}


def _get_reconciliation_remaining_per_entry(admission: str) -> list[dict]:
	"""For an admission, compute remaining quantity per Inpatient Medication Order Entry using FIFO allocation of Medicine Given."""
	# Exclude transfer-created PMOs: those always have patient_encounter set (linked to a follow-up visit).
	# Original inpatient PMOs never have patient_encounter, regardless of care_context value.
	order_names = frappe.get_all(
		"Patient Medication Order",
		filters={"inpatient_record": admission, "patient_encounter": ["is", "not set"]},
		pluck="name",
	)
	
	if not order_names:
		return []

	filters = {"parent": ["in", order_names]}
	if frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
		filters["transferred_to_visit"] = ["is", "not set"]
	if frappe.db.has_column("Inpatient Medication Order Entry", "returned_to_store"):
		filters["returned_to_store"] = ["in", [0, ""]]
	fields = ["name", "parent", "drug", "drug_name", "quantity", "date", "creation", "reason_stopped"]
	if frappe.db.has_column("Inpatient Medication Order Entry", "returned_to_store"):
		fields.append("returned_to_store")
	entries = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters=filters,
		fields=fields,
		order_by="date asc, creation asc",
	)
	if not entries:
		return []

	admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
	given_rows = []
	if admission_detail_name:
		given_rows = frappe.get_all(
			"Medicine Given",
			filters={"parent": admission_detail_name, "parenttype": "Admission Detail"},
			fields=["medicine_code", "qty"],
			order_by="date asc, time asc, creation asc",
		)

	# Per-drug: list of (entry_name, quantity); per-drug given to allocate
	from collections import defaultdict
	entries_by_drug = defaultdict(list)
	for e in entries:
		drug = e.get("drug")
		if not drug or flt(e.get("quantity"), 0) <= 0:
			continue
		entries_by_drug[drug].append({"name": e["name"], "parent": e["parent"], "quantity": flt(e["quantity"]), "date": e.get("date"), "creation": e.get("creation"), "drug_name": e.get("drug_name")})

	given_by_drug = defaultdict(lambda: 0)
	for g in given_rows:
		drug = g.get("medicine_code")
		if drug:
			given_by_drug[drug] += flt(g.get("qty") or 0)

	# FIFO: for each drug, consume "given" from first entries first
	remaining_per_entry = {}
	for drug, entry_list in entries_by_drug.items():
		to_allocate = given_by_drug.get(drug, 0)
		for ent in entry_list:
			allocated = min(ent["quantity"], to_allocate)
			to_allocate -= allocated
			rem = ent["quantity"] - allocated
			row_data = {
			"name": ent["name"],
			"parent": ent["parent"],
			"drug": drug,
			"drug_name": ent.get("drug_name"),
			"quantity": ent["quantity"],
			"remaining": rem,
		}
		if "reason_stopped" in ent:
			row_data["reason_stopped"] = ent.get("reason_stopped") or ""
		if "returned_to_store" in ent:
			row_data["returned_to_store"] = cint(ent.get("returned_to_store"))
		remaining_per_entry[ent["name"]] = row_data

	return [v for v in remaining_per_entry.values() if flt(v.get("remaining"), 0) > 0]


@frappe.whitelist()
def get_discharge_reconciliation_rows(admission: str) -> list[dict]:
	"""Return list of Inpatient Medication Order Entry rows that have remaining (not yet given) quantity for medicine reconciliation on discharge."""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))
	
	rows = _get_reconciliation_remaining_per_entry(admission)
	return rows


@frappe.whitelist()
def get_discharge_transfer_rows(admission: str) -> list[dict]:
	"""Return prescribed medication order entries for transfer on discharge.

	Unlike reconciliation, this does not compare against Medicine Given.
	It returns original inpatient prescription rows that are not yet transferred.
	"""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))

	order_names = frappe.get_all(
		"Patient Medication Order",
		filters={"inpatient_record": admission, "patient_encounter": ["is", "not set"]},
		pluck="name",
	)
	if not order_names:
		return []
	
	filters = {"parent": ["in", order_names]}
	if frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
		filters["transferred_to_visit"] = ["is", "not set"]

	fields = [
		"name",
		"parent",
		"drug",
		"drug_name",
		"quantity",
		"reason_stopped",
		"dosage",
		"no_of_days",
		"dosage_form",
		"instructions",
		"date",
		"time",
		"patient_frequency",
		"is_pink",
		"reference_no",
		"route_of_administration",
		"is_long_acting_medicine",
		"end_date",
		"creation",
	]
	for col in (
		"old_medicine_code",
		"old_medicine_name",
		"medication",
		"medicine_no",
		"written_frequency",
		"medication_type",
		"strength",
		"stopped",
		"medication_status",
	):
		if frappe.db.has_column("Inpatient Medication Order Entry", col):
			fields.append(col)

	rows = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters=filters,
		fields=fields,
		order_by="date asc, creation asc",
	)
	result = []
	for row in rows:
		# Stopped / discontinued lines are shown separately — do not transfer them home.
		if _entry_is_stopped_for_discharge(row):
			continue
		result.append(row)

	# Same ITEM_00_01 → Item mapping used by prescription Duplicate.
	from healthcare.api.patient_medication_order_import import apply_current_item_mapping_to_medication_rows

	return apply_current_item_mapping_to_medication_rows(result)


def _inpatient_medication_entry_fields() -> list[str]:
	fields = [
		"name",
		"parent",
		"drug",
		"drug_name",
		"dosage",
		"instructions",
		"patient_frequency",
		"written_frequency",
		"date",
		"end_date",
		"reason_stopped",
		"quantity",
		"creation",
	]
	for col in (
		"old_medicine_code",
		"old_medicine_name",
		"medication",
		"medicine_no",
		"strength",
		"trans_num",
		"reference_no",
		"stopped",
		"medication_status",
	):
		if frappe.db.has_column("Inpatient Medication Order Entry", col):
			fields.append(col)
	if frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
		fields.append("transferred_to_visit")
	return fields


def _entry_is_stopped_for_discharge(entry: dict) -> bool:
	"""True when medicine should appear under Stopped on discharge UI.

	Stopped if reason_stopped is set, stopped checkbox is ticked, or medication_status is Discontinued.
	"""
	if (entry.get("reason_stopped") or "").strip():
		return True
	if cint(entry.get("stopped")):
		return True
	status = (entry.get("medication_status") or "").strip().lower()
	return status in ("discontinued", "stopped")


def _format_discharge_prescription_entry(entry: dict, parent_start_date=None) -> dict:
	from healthcare.api.medication_order_display import (
		is_legacy_medication_entry,
		medication_entry_display_fields,
	)
	from healthcare.api.patient_medication_order_import import resolve_current_item_from_legacy

	display = medication_entry_display_fields(entry, parent_start_date=parent_start_date)
	reason = (entry.get("reason_stopped") or "").strip()
	medication_status = (entry.get("medication_status") or "").strip()
	if not reason and (
		cint(entry.get("stopped")) or medication_status.lower() in ("discontinued", "stopped")
	):
		reason = medication_status or "Discontinued"
	legacy = bool(display.get("is_legacy") or is_legacy_medication_entry(entry))
	old_code = (entry.get("old_medicine_code") or entry.get("medicine_no") or "").strip()
	old_name = (entry.get("old_medicine_name") or entry.get("medication") or "").strip()
	drug = (entry.get("drug") or "").strip()
	drug_name = (entry.get("drug_name") or "").strip()

	mapped = None
	if not drug or legacy:
		mapped = resolve_current_item_from_legacy(old_code or drug)
		if mapped:
			if not drug:
				drug = mapped.get("item") or ""
			if not drug_name:
				drug_name = mapped.get("item_name") or ""

	# Prefer current Item name when mapped; always keep a clear legacy fallback.
	primary_name = drug_name or (mapped or {}).get("item_name") or ""
	legacy_label = old_name or old_code
	if primary_name and legacy_label and primary_name.strip().upper() != legacy_label.strip().upper():
		display_name = f"{primary_name} (legacy: {legacy_label})"
	elif primary_name:
		display_name = primary_name
	elif legacy_label:
		display_name = legacy_label
	else:
		display_name = display.get("display_drug_name") or "-"

	result = {
		"name": entry.get("name"),
		"prescription": entry.get("parent") or "",
		"drug": drug,
		"drug_name": display_name,
		"dosage": display.get("display_dosage") or "-",
		"frequency": display.get("display_frequency") or "-",
		"start_date": display.get("display_start_date"),
		"reason_stopped": reason,
		"medication_status": medication_status,
		"stopped": 1 if cint(entry.get("stopped")) else 0,
		"is_legacy": 1 if legacy or bool(old_code or old_name) else 0,
		"old_medicine_code": old_code,
		"old_medicine_name": old_name,
		"medication": (entry.get("medication") or "").strip(),
		"medicine_no": (entry.get("medicine_no") or "").strip(),
		"mapped_drug": (mapped or {}).get("item") or "",
		"mapped_drug_name": (mapped or {}).get("item_name") or "",
	}
	transferred = (entry.get("transferred_to_visit") or "").strip()
	if transferred:
		result["transferred_to_visit"] = transferred
	return result


def _inpatient_admission_pmo_names(admission: str) -> list[str]:
	return frappe.get_all(
		"Patient Medication Order",
		filters={
			"inpatient_record": admission,
			"patient_encounter": ["is", "not set"],
			"docstatus": ["!=", 2],
		},
		pluck="name",
	)


def _after_discharge_pmo_names_for_admission(admission: str) -> list[str]:
	"""After-discharge PMOs for an admission (via linked visits or discharge_id)."""
	if not admission:
		return []

	names: set[str] = set()
	base_filters = {"after_discharge": 1, "docstatus": ["!=", 2]}

	visit_names = frappe.get_all(
		"Patient Visit",
		filters={"inpatient_record": admission},
		pluck="name",
	)
	if visit_names:
		names.update(
			frappe.get_all(
				"Patient Medication Order",
				filters={**base_filters, "patient_encounter": ["in", visit_names]},
				pluck="name",
			)
		)

	# Discharge.name = admission (autoname field:admission). PMOs may link here even when
	# the Patient Visit was reused without inpatient_record set.
	if frappe.db.has_column("Patient Medication Order", "discharge_id"):
		names.update(
			frappe.get_all(
				"Patient Medication Order",
				filters={**base_filters, "discharge_id": admission},
				pluck="name",
			)
		)

	return sorted(names)


@frappe.whitelist()
def get_discharge_prescription_sections(admission: str) -> dict:
	"""Current, discharged, and stopped medications for discharge prescription UI."""
	if not admission:
		frappe.throw(_("Admission (Inpatient Admission) is required"))

	order_names = _inpatient_admission_pmo_names(admission)
	pmo_start_dates = {}
	if order_names:
		for row in frappe.get_all(
			"Patient Medication Order",
			filters={"name": ["in", order_names]},
			fields=["name", "start_date"],
		):
			pmo_start_dates[row.name] = row.get("start_date")

	current_medications: list[dict] = []
	stopped_medications: list[dict] = []

	if order_names:
		entry_filters: dict = {"parent": ["in", order_names]}
		entries = frappe.get_all(
			"Inpatient Medication Order Entry",
			filters=entry_filters,
			fields=_inpatient_medication_entry_fields(),
			order_by="date asc, creation asc",
		)
		for entry in entries:
			formatted = _format_discharge_prescription_entry(
				entry, parent_start_date=pmo_start_dates.get(entry.get("parent"))
			)
			if _entry_is_stopped_for_discharge(entry):
				stopped_medications.append(formatted)
			else:
				# Keep in current even after transferred_to_visit — shows medicines in use on admission.
				current_medications.append(formatted)

	discharged_medications: list[dict] = []
	discharge_pmo_names = _after_discharge_pmo_names_for_admission(admission)
	if discharge_pmo_names:
		pmo_meta = {
			row.name: row
			for row in frappe.get_all(
				"Patient Medication Order",
				filters={"name": ["in", discharge_pmo_names]},
				fields=["name", "start_date", "patient_encounter"],
			)
		}
		discharge_entries = frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={"parent": ["in", discharge_pmo_names]},
			fields=_inpatient_medication_entry_fields(),
			order_by="date asc, creation asc",
		)
		for entry in discharge_entries:
			parent = entry.get("parent")
			formatted = _format_discharge_prescription_entry(
				entry, parent_start_date=(pmo_meta.get(parent) or {}).get("start_date")
			)
			formatted["patient_visit"] = (pmo_meta.get(parent) or {}).get("patient_encounter")
			discharged_medications.append(formatted)

	return {
		"current_medications": current_medications,
		"discharged_medications": discharged_medications,
		"stopped_medications": stopped_medications,
	}


def _get_warehouse_for_admission(admission: str):
	admission_doc = frappe.get_doc("Inpatient Admission", admission)
	company = admission_doc.company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required to create Stock Entry"))
	# Company no longer has default_warehouse in current ERPNext; use Stock Settings.
	warehouse = frappe.db.get_single_value("Stock Settings", "default_warehouse")
	if not warehouse:
		frappe.throw(_("Default warehouse is not set in Stock Settings. Please configure before reconciling medicines."))
	return warehouse, company


def _get_return_warehouse_for_admission(admission: str):
	"""Warehouse for returning medicines to store (discharge reconciliation). Uses Healthcare Settings Default Return Medicine only."""
	warehouse = frappe.db.get_single_value("Healthcare Settings", "default_return_medicine")
	if not warehouse:
		frappe.throw(
			_("Default Return Medicine warehouse is not set. Please set it in Healthcare Settings to return medicines to store.")
		)
	admission_doc = frappe.get_doc("Inpatient Admission", admission)
	company = admission_doc.company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required to create Stock Entry"))
	return warehouse, company


def _get_cost_center_for_admission(admission: str, company: str | None = None) -> str:
	"""Resolve cost center for Stock Entry: admission first, then Company default."""
	cost_center = frappe.db.get_value("Inpatient Admission", admission, "cost_center")
	if not cost_center and company:
		cost_center = frappe.get_cached_value("Company", company, "cost_center")
	if not cost_center:
		frappe.throw(
			_(
				"Cost Center is required to create Stock Entry. "
				"Please set Cost Center on the Inpatient Admission or Company default Cost Center."
			)
		)
	return cost_center


@frappe.whitelist()
def stop_medication_on_discharge(admission: str, order_entry_name: str, reason_stopped: str = "") -> dict:
	"""Mark one medication order entry as stopped: save reason_stopped on the prescription child table. Use return_stopped_medications_to_store to create the stock entry for all stopped items."""
	if not admission or not order_entry_name:
		frappe.throw(_("Admission and order entry name are required"))

	order_names = frappe.get_all(
		"Patient Medication Order",
		filters={"inpatient_record": admission, "docstatus": 1, "patient_encounter": ["is", "not set"]},
		pluck="name",
	)
	if not order_names:
		frappe.throw(_("No medication orders found for this admission."))
	parent = frappe.db.get_value("Inpatient Medication Order Entry", order_entry_name, "parent")
	if not parent or parent not in order_names:
		frappe.throw(_("Order entry {0} does not belong to this admission.").format(frappe.bold(order_entry_name)))

	frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "reason_stopped", (reason_stopped or "").strip())
	frappe.db.commit()
	return {"message": "Reason saved. Use 'Return selected' to create stock entry for all stopped medicines."}


def _get_stopped_entries_with_remaining(admission: str) -> list[dict]:
	"""Return order entries for this admission that have reason_stopped set, not yet returned_to_store, with their remaining qty (FIFO)."""
	order_names = frappe.get_all(
		"Patient Medication Order",
		filters={"inpatient_record": admission, "docstatus": 1, "patient_encounter": ["is", "not set"]},
		pluck="name",
	)
	if not order_names:
		return []
	filters = {"parent": ["in", order_names], "reason_stopped": ["!=", ""]}
	if frappe.db.has_column("Inpatient Medication Order Entry", "returned_to_store"):
		filters["returned_to_store"] = ["in", [0, ""]]
	if frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
		filters["transferred_to_visit"] = ["is", "not set"]
	fields = ["name", "parent", "drug", "drug_name", "quantity", "date", "creation"]
	stopped_entries = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters=filters,
		fields=fields,
		order_by="date asc, creation asc",
	)
	if not stopped_entries:
		return []
	# Get remaining qty for each entry using same FIFO as full list (all entries for admission)
	all_rows = _get_reconciliation_remaining_per_entry(admission)
	remaining_by_name = {r["name"]: flt(r.get("remaining"), 0) for r in all_rows}
	result = []
	for e in stopped_entries:
		rem = remaining_by_name.get(e["name"], 0)
		if rem > 0:
			result.append({
				"name": e["name"],
				"drug": e.get("drug"),
				"drug_name": e.get("drug_name"),
				"remaining": rem,
			})
	return result


@frappe.whitelist()
def return_stopped_medications_to_store(admission: str, order_entry_names: str | list | None = None) -> dict:
	"""Create one Stock Entry (Material Receipt) for medications to return.
	If order_entry_names is provided: return only those entries; each must have reason_stopped set.
	If not provided: return all that have reason_stopped set and not yet returned."""
	if not admission:
		frappe.throw(_("Admission is required"))

	if order_entry_names is not None:
		names = order_entry_names if isinstance(order_entry_names, list) else json.loads(order_entry_names or "[]")
	else:
		names = None

	if names is not None:
		if not names:
			return {"stock_entry": None, "message": "No medicines selected to return."}
		# Validate each has reason_stopped; get remaining for each
		order_names = frappe.get_all(
			"Patient Medication Order",
			filters={"inpatient_record": admission, "patient_encounter": ["is", "not set"]},
			pluck="name",
		)
		entries = frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={"name": ["in", names], "parent": ["in", order_names]},
			fields=["name", "drug", "drug_name", "quantity", "date", "creation", "reason_stopped"],
		)
		if len(entries) != len(names):
			frappe.throw(_("One or more selected entries do not belong to this admission."))
		# Require reason_stopped for each
		missing = [e.get("drug_name") or e.get("drug") or e.get("name") for e in entries if not (e.get("reason_stopped") or "").strip()]
		if missing:
			frappe.throw(_("Reason stopped is required for each medicine being returned. Missing for: {0}").format(", ".join(missing)))
		# Get remaining qty for these entries (FIFO)
		all_rows = _get_reconciliation_remaining_per_entry(admission)
		remaining_by_name = {r["name"]: flt(r.get("remaining"), 0) for r in all_rows}
		stopped = []
		for e in entries:
			rem = remaining_by_name.get(e["name"], 0)
			if rem > 0:
				stopped.append({"name": e["name"], "drug": e.get("drug"), "drug_name": e.get("drug_name"), "remaining": rem})
	else:
		stopped = _get_stopped_entries_with_remaining(admission)

	if not stopped:
		return {"stock_entry": None, "message": "No medicines with remaining quantity to return."}

	warehouse, company = _get_return_warehouse_for_admission(admission)
	cost_center = _get_cost_center_for_admission(admission, company)

	# Aggregate by drug (same drug can appear in multiple entries)
	from collections import defaultdict
	qty_by_drug = defaultdict(lambda: 0)
	entry_names_by_drug = defaultdict(list)
	for row in stopped:
		drug = row.get("drug")
		if drug:
			qty_by_drug[drug] += flt(row.get("remaining"), 0)
			entry_names_by_drug[drug].append(row["name"])

	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry.purpose = "Material Receipt"
	stock_entry.set_stock_entry_type()
	stock_entry.to_warehouse = warehouse
	stock_entry.company = company
	stock_entry.cost_center = cost_center

	items_summary = []
	for drug, qty in qty_by_drug.items():
		if qty <= 0:
			continue
		item_row = stock_entry.append("items", {})
		item_row.item_code = drug
		item_row.item_name = frappe.db.get_value("Item", drug, "item_name") or drug
		item_row.uom = frappe.db.get_value("Item", drug, "stock_uom")
		item_row.stock_uom = item_row.uom
		item_row.t_warehouse = warehouse
		item_row.qty = qty
		item_row.conversion_factor = 1
		item_row.cost_center = cost_center
		items_summary.append({"item_code": drug, "qty": qty})

	stock_entry.insert(ignore_permissions=True)

	# Mark all stopped entries that were included as returned_to_store
	if frappe.db.has_column("Inpatient Medication Order Entry", "returned_to_store"):
		all_entry_names = [row["name"] for row in stopped]
		for name in all_entry_names:
			frappe.db.set_value("Inpatient Medication Order Entry", name, "returned_to_store", 1)
		frappe.db.commit()

	return {"stock_entry": stock_entry.name, "items": items_summary}


@frappe.whitelist()
def transfer_medications_on_discharge(admission: str, order_entry_names: str | list) -> dict:
	"""Create a Patient Visit (Follow-up for the Psychiatrist) and a new Patient Medication Order linked to it and to the admission, with the selected order entries copied over."""
	if not admission:
		frappe.throw(_("Admission is required"))
	if not order_entry_names:
		frappe.throw(_("At least one order entry must be selected to transfer"))

	names = order_entry_names if isinstance(order_entry_names, list) else json.loads(order_entry_names or "[]")
	if not names:
		frappe.throw(_("At least one order entry must be selected to transfer"))

	admission_doc = frappe.get_doc("Inpatient Admission", admission)
	patient = admission_doc.patient
	patient_name = admission_doc.patient_name
	practitioner = getattr(admission_doc, "primary_practitioner", None) or getattr(admission_doc, "secondary_practitioner", None)
	company = admission_doc.company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required"))

	# Validate entries belong to original inpatient PMOs only (patient_encounter not set)
	order_names = frappe.get_all(
		"Patient Medication Order",
		filters={"inpatient_record": admission, "patient_encounter": ["is", "not set"]},
		pluck="name",
	)
	entries = frappe.get_all(
		"Inpatient Medication Order Entry",
		filters={"name": ["in", names], "parent": ["in", order_names]},
		fields=["name", "parent", "drug", "drug_name", "dosage", "no_of_days", "dosage_form", "instructions", "date", "time", "patient_frequency", "is_pink", "reference_no", "route_of_administration", "is_long_acting_medicine", "end_date"],
	)
	if len(entries) != len(names):
		frappe.throw(_("One or more selected entries do not belong to this admission."))

	# Create Patient Visit: type Follow-up for the Psychiatrist
	visit_type = "Follow-up for the Psychiatrist"
	pv = frappe.new_doc("Patient Visit")
	pv.patient = patient
	pv.patient_name = patient_name
	pv.visit_type = visit_type
	pv.status = "Open"
	pv.encounter_date = getdate(nowdate())
	pv.inpatient_record = admission
	if practitioner:
		pv.practitioner = practitioner
	pv.company = company
	pv.insert(ignore_permissions=True)
	frappe.db.commit()

	# Build medication_orders list from selected entries for create_patient_medication_order
	from healthcare.api.patient_medication_order import create_patient_medication_order

	medication_orders = []
	for e in entries:
		medication_orders.append({
			"drug": e.get("drug"),
			"dosage": e.get("dosage"),
			"no_of_days": e.get("no_of_days"),
			"dosage_form": e.get("dosage_form"),
			"instructions": e.get("instructions") or "",
			"date": e.get("date"),
			"time": e.get("time") or "00:00:00",
			"patient_frequency": e.get("patient_frequency"),
			"is_pink": cint(e.get("is_pink")),
			"reference_no": e.get("reference_no") or "",
			"route_of_administration": e.get("route_of_administration"),
			"is_long_acting_medicine": cint(e.get("is_long_acting_medicine")),
			"end_date": e.get("end_date"),
		})

	start_date = nowdate()
	discharge_id = _resolve_discharge_id_for_admission(admission)
	result = create_patient_medication_order(
		patient=patient,
		care_context="Patient Visit",
		company=company,
		start_date=start_date,
		patient_encounter=pv.name,
		inpatient_record=None,
		practitioner=practitioner,
		medication_orders=medication_orders,
		discharge_id=discharge_id,
	)
	pmo_name = result.get("name")

	# NOTE: we intentionally do NOT set inpatient_record on the new PMO.
	# The Patient Visit already carries inpatient_record → admission so the trail is preserved.
	# Back-linking the PMO would make its entries reappear in reconciliation (same admission query).

	# Mark these order entries as transferred so they no longer appear in reconciliation list
	if frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
		for name in names:
			frappe.db.set_value("Inpatient Medication Order Entry", name, "transferred_to_visit", pv.name)
		frappe.db.commit()

	return {
		"patient_visit": pv.name,
		"patient_medication_order": pmo_name,
	}


def _resolve_discharge_id_for_admission(admission: str) -> str | None:
	"""Draft Discharge name for linking discharge prescriptions; creates draft if missing."""
	if not admission:
		return None

	from healthcare.api.inpatient_admission import (
		_get_draft_discharge_name,
		_get_or_create_draft_discharge,
	)

	existing = _get_draft_discharge_name(admission)
	if existing:
		return existing

	discharge_doc = _get_or_create_draft_discharge(admission)
	discharge_doc.flags.ignore_links = True
	if discharge_doc.get("__islocal"):
		discharge_doc.insert(ignore_permissions=True)
	else:
		discharge_doc.save(ignore_permissions=True)
	frappe.db.commit()
	return discharge_doc.name


def _sync_discharge_after_prescription_created(admission: str, pmo_name: str) -> None:
	"""Link the new PMO to the draft Discharge and tick medication checklist rows."""
	if not admission or not pmo_name:
		return

	draft_name = _resolve_discharge_id_for_admission(admission)
	if not draft_name:
		return

	if frappe.db.has_column("Patient Medication Order", "discharge_id"):
		frappe.db.set_value(
			"Patient Medication Order",
			pmo_name,
			"discharge_id",
			draft_name,
			update_modified=False,
		)

	discharge_doc = frappe.get_doc("Discharge", draft_name, ignore_permissions=True)
	if discharge_doc.meta.has_field("prescription"):
		discharge_doc.prescription = pmo_name

	medication_keys = (
		"discharge medication entered",
		"discharged medication entered",
	)
	now = now_datetime()
	user = frappe.session.user or ""
	for row in discharge_doc.discharge_checklist or []:
		action = (row.action_required or "").strip().lower()
		if any(key in action for key in medication_keys):
			if not cint(row.click):
				row.click = 1
				row.date_time = now
				if user:
					row.user = user

	discharge_doc.flags.ignore_links = True
	discharge_doc.save(ignore_permissions=True)
	frappe.db.commit()


@frappe.whitelist()
def create_visit_and_prescription_on_discharge(
	admission: str,
	medication_orders=None,
	patient_encounter: str | None = None,
	after_discharge: bool | str | None = None,
	doctors_signature: str | None = None,
	order_entry_names: str | list | None = None,
) -> dict:
	"""Create a Patient Visit and a Patient Medication Order from discharge transfer medicines."""
	if not admission:
		frappe.throw(_("Admission is required"))

	admission_doc = frappe.get_doc("Inpatient Admission", admission)
	patient = admission_doc.patient
	patient_name = admission_doc.patient_name
	practitioner = getattr(admission_doc, "primary_practitioner", None) or getattr(admission_doc, "secondary_practitioner", None)
	company = admission_doc.company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required"))

	if isinstance(medication_orders, str):
		medication_orders = json.loads(medication_orders or "[]")
	if not medication_orders:
		frappe.throw(_("At least one medication order is required"))

	if patient_encounter:
		pv = frappe.get_doc("Patient Visit", patient_encounter)
		if pv.patient != patient:
			frappe.throw(_("Selected Patient Visit does not belong to this patient"))
		visit_dirty = False
		if not pv.inpatient_record:
			pv.inpatient_record = admission
			visit_dirty = True
		if not cint(getattr(pv, "during_discharge", 0)):
			pv.during_discharge = 1
			visit_dirty = True
		if visit_dirty:
			pv.save(ignore_permissions=True)
			frappe.db.commit()
	else:
		visit_type = "Follow-up for the Psychiatrist"
		pv = frappe.new_doc("Patient Visit")
		pv.case_no = get_next_transaction_number('Patient Visit', fieldname='case_no')
		pv.patient = patient
		pv.patient_name = patient_name
		pv.visit_type = visit_type
		pv.status = "Open"
		pv.encounter_date = getdate(nowdate())
		pv.inpatient_record = admission
		if practitioner:
			pv.practitioner = practitioner
		pv.company = company
		pv.during_discharge = 1
		pv.insert(ignore_permissions=True)
		frappe.db.commit()

	from healthcare.api.patient_medication_order import create_patient_medication_order

	discharge_id = _resolve_discharge_id_for_admission(admission)
	# Always mark as after-discharge — this API is only used for discharge medication transfer
	result = create_patient_medication_order(
		patient=patient,
		care_context="Patient Visit",
		company=company,
		start_date=nowdate(),
		patient_encounter=pv.name,
		practitioner=practitioner,
		medication_orders=medication_orders,
		after_discharge=True,
		doctors_signature=doctors_signature,
		discharge_id=discharge_id,
	)

	if order_entry_names is not None:
		names = order_entry_names if isinstance(order_entry_names, list) else json.loads(order_entry_names or "[]")
		if names and frappe.db.has_column("Inpatient Medication Order Entry", "transferred_to_visit"):
			for entry_name in names:
				frappe.db.set_value(
					"Inpatient Medication Order Entry",
					entry_name,
					"transferred_to_visit",
					pv.name,
				)
			frappe.db.commit()

	pmo_name = result.get("name")
	if pmo_name:
		_sync_discharge_after_prescription_created(admission, pmo_name)

	return {
		"patient_visit": pv.name,
		"patient_medication_order": pmo_name,
	}


