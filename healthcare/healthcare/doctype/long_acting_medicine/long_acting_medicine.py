# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from collections.abc import Iterable

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, cint, getdate, nowdate, nowtime


LONG_ACTING_GIVE_OUT_ROLES = frozenset(
	{
		"Administrator",
		"System Manager",
		"Healthcare Administrator",
		"Doctor",
		"Nurse",
		"Physician",
		"Nursing User",
	}
)

# Doctors create a fresh order (Duplicate) when the next run is due after the first give-out.
LONG_ACTING_DUPLICATE_ROLES = frozenset(
	{
		"Administrator",
		"System Manager",
		"Healthcare Administrator",
		"Doctor",
		"Physician",
	}
)


def _long_acting_frequency_interval_days(frequency):
	if not frequency:
		return 7
	frequency = frequency.strip()
	interval = frappe.db.get_value("Long Acting Frequency", frequency, "interval_days")
	if interval:
		return cint(interval)
	m = {
		"Weekly": 7,
		"Biweekly": 14,
		"Monthly": 30,
		"Every 2 Months": 60,
		"Every 3 Months": 90,
	}
	return m.get(frequency, 7)


def user_can_give_out_long_acting_medicine(user=None):
	user = user or frappe.session.user
	if user in ("Guest", ""):
		return False
	return bool(LONG_ACTING_GIVE_OUT_ROLES & set(frappe.get_roles(user)))


def user_can_duplicate_long_acting_medicine(user=None):
	user = user or frappe.session.user
	if user in ("Guest", ""):
		return False
	return bool(LONG_ACTING_DUPLICATE_ROLES & set(frappe.get_roles(user)))


def _active_long_acting_status(status):
	return status in (None, "", "Active", "Draft")


def _row_field(row, field):
	if not row:
		return None
	if isinstance(row, dict):
		return row.get(field)
	return getattr(row, field, None)


def _safe_getdate(value):
	if not value:
		return None
	try:
		return getdate(value)
	except Exception:
		return None


LONG_ACTING_GIVE_OUT_FIELDS = [
	"name",
	"date",
	"time",
	"user",
	"scheduled_run_date",
	"notes",
	"creation",
	"trans_no",
	"cr_id",
	"cr_date",
	"up_id",
	"up_date",
	"dose",
	"medication",
	"nurse_flag",
	"written_frequency",
	"is_cancelled",
	"cancelled_notes",
	"next_dose",
	"dose_term",
	"rt_flag",
	"lt_flag",
]


def _has_give_out_for_scheduled_date(doc, scheduled_run_date):
	scheduled = getdate(scheduled_run_date)
	for row in doc.get("give_outs") or []:
		row_date = _safe_getdate(_row_field(row, "scheduled_run_date"))
		if row_date and row_date == scheduled:
			return True
	return False


def _medication_display_label(drug_name=None, old_medication_name=None, medication=None):
	return (drug_name or "").strip() or (old_medication_name or "").strip() or (medication or "").strip() or None


def _first_medication_labels_for_parents(parent_names):
	"""Map LAM name -> first medication label (drug_name, else old_medication_name, else give-out medication)."""
	if not parent_names:
		return {}

	labels = {}
	med_rows = frappe.get_all(
		"Subscription Medication Plan Item",
		filters={"parent": ["in", parent_names]},
		fields=["parent", "drug_name", "old_medication_name", "idx"],
		order_by="parent asc, idx asc",
	)
	for row in med_rows:
		if row.parent in labels:
			continue
		label = _medication_display_label(row.drug_name, row.old_medication_name)
		if label:
			labels[row.parent] = label

	missing = [name for name in parent_names if name not in labels]
	if missing:
		give_out_rows = frappe.get_all(
			"Long Acting Medicine Give Out",
			filters={"parent": ["in", missing]},
			fields=["parent", "medication", "idx"],
			order_by="parent asc, idx asc",
		)
		for row in give_out_rows:
			if row.parent in labels:
				continue
			label = _medication_display_label(medication=row.medication)
			if label:
				labels[row.parent] = label

	return labels


def _first_medication_doses_for_parents(parent_names):
	"""Map LAM name -> {default_dosage, default_uom, default_dosage_form} from first plan item."""
	if not parent_names:
		return {}

	defaults = {}
	med_rows = frappe.get_all(
		"Subscription Medication Plan Item",
		filters={"parent": ["in", parent_names]},
		fields=["parent", "dosage", "dosage_form", "uom", "drug", "medication_order_entry", "idx"],
		order_by="parent asc, idx asc",
	)

	entry_names = list(
		{
			(row.medication_order_entry or "").strip()
			for row in med_rows
			if (row.medication_order_entry or "").strip()
		}
	)
	drug_names = list({(row.drug or "").strip() for row in med_rows if (row.drug or "").strip()})

	entry_uoms: dict[str, str] = {}
	if entry_names:
		for erow in frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={"name": ["in", entry_names]},
			fields=["name", "uom"],
		):
			if (erow.uom or "").strip():
				entry_uoms[erow.name] = erow.uom.strip()

	drug_uoms: dict[str, str] = {}
	if drug_names:
		for drow in frappe.get_all(
			"Item",
			filters={"name": ["in", drug_names]},
			fields=["name", "stock_uom"],
		):
			if (drow.stock_uom or "").strip():
				drug_uoms[drow.name] = drow.stock_uom.strip()

	for row in med_rows:
		if row.parent in defaults:
			continue
		dosage = _format_dosage_value(row.dosage)
		dosage_form = (row.dosage_form or "").strip() or None
		# Prefer the unit stored on the plan row (editable from the LAM edit modal);
		# fall back to the linked prescription line / Item stock UOM.
		uom = (row.uom or "").strip() or None
		entry = (row.medication_order_entry or "").strip()
		drug = (row.drug or "").strip()
		if not uom:
			if entry and entry in entry_uoms:
				uom = entry_uoms[entry]
			elif drug and drug in drug_uoms:
				uom = drug_uoms[drug]
		if dosage or uom or dosage_form:
			defaults[row.parent] = {
				"default_dosage": dosage,
				"default_uom": uom,
				"default_dosage_form": dosage_form,
			}
	return defaults


def _format_dosage_value(dosage=None):
	if dosage in (None, "", 0, 0.0):
		return None
	text = str(dosage).strip()
	if isinstance(dosage, float) and text.endswith(".0"):
		text = text[:-2]
	if not text or text == "0":
		return None
	return text


def _resolve_uom_for_plan_item(med) -> str | None:
	"""Unit of Measure stored on the plan row, else from linked order entry / Item stock UOM.

	The plan-row ``uom`` is editable from the Long Acting Medicine edit modal. Older
	rows (and rows created before the field existed) leave it blank, so the unit is
	still derived from the prescription line and then the Item.
	"""
	stored = str(_row_field(med, "uom") or "").strip()
	if stored:
		return stored
	entry = (_row_field(med, "medication_order_entry") or "").strip()
	if entry and frappe.db.exists("Inpatient Medication Order Entry", entry):
		uom = frappe.db.get_value("Inpatient Medication Order Entry", entry, "uom")
		if (uom or "").strip():
			return str(uom).strip()
	drug = (_row_field(med, "drug") or "").strip()
	if drug:
		uom = frappe.db.get_value("Item", drug, "stock_uom")
		if (uom or "").strip():
			return str(uom).strip()
	return None


def _format_medication_dose(dosage=None, uom=None):
	dose = _format_dosage_value(dosage)
	unit = (uom or "").strip() or None
	if not dose:
		return None
	if unit:
		return f"{dose} {unit}".strip()
	return dose


def _plan_item_dose_fields(med):
	uom = _resolve_uom_for_plan_item(med)
	return {
		"dose": _format_dosage_value(_row_field(med, "dosage")),
		"dose_term": uom,
		"uom": uom,
	}


def _normalize_injection_given_on(value):
	side = (value or "").strip().upper()
	if side in ("LT", "L", "LEFT"):
		return "LT"
	if side in ("RT", "R", "RIGHT"):
		return "RT"
	return None


def _injection_side_from_row(row) -> str | None:
	"""Side recorded on one give-out row (``RT_FLAG`` / ``LT_FLAG`` from the legacy register)."""
	if not row:
		return None
	lt = str(_row_field(row, "lt_flag") or "").strip().upper()
	rt = str(_row_field(row, "rt_flag") or "").strip().upper()
	if lt and lt not in ("0", "N", "FALSE"):
		return "LT"
	if rt and rt not in ("0", "N", "FALSE"):
		return "RT"
	return None


def _last_injection_side(give_outs: Iterable) -> str | None:
	"""Side recorded on the *most recent* give-out (rows may arrive in any order).

	Only the newest injection answers "which side was last used?" - falling back to an
	older flagged row would suggest the wrong side to alternate to.
	"""
	newest = None
	newest_key = None
	for row in give_outs or []:
		row_date = _row_field(row, "date") or _row_field(row, "scheduled_run_date")
		if not row_date:
			continue
		key = (
			str(row_date),
			str(_row_field(row, "time") or ""),
			str(_row_field(row, "creation") or ""),
		)
		if newest_key is None or key > newest_key:
			newest_key = key
			newest = row
	return _injection_side_from_row(newest)


def _injection_flags_from_side(side):
	if side == "LT":
		return {"lt_flag": "1", "rt_flag": None}
	if side == "RT":
		return {"rt_flag": "1", "lt_flag": None}
	return {"lt_flag": None, "rt_flag": None}


def _first_medication_give_out_fields(doc):
	"""Medication + dose from the first plan item on a Long Acting Medicine doc."""
	for med in doc.get("medications") or []:
		medication = _medication_display_label(
			_row_field(med, "drug_name"),
			_row_field(med, "old_medication_name"),
		)
		if not medication:
			continue
		dose_fields = _plan_item_dose_fields(med)
		return {
			"medication": medication,
			"dose": dose_fields["dose"],
			"dose_term": dose_fields["dose_term"],
			"written_frequency": doc.get("written_frequency") or _row_field(med, "patient_frequency"),
		}

	medication = _first_medication_labels_for_parents([doc.name]).get(doc.name)
	if not medication:
		return {}

	return {
		"medication": medication,
		"dose": None,
		"dose_term": None,
		"written_frequency": doc.get("written_frequency"),
	}


def enrich_long_acting_medicine_row(doc):
	"""Attach give-out summary fields for portal list/detail views."""
	data = doc.as_dict() if isinstance(doc, Document) else dict(doc)
	name = data.get("name")
	if name and not data.get("give_outs"):
		data["give_outs"] = frappe.get_all(
			"Long Acting Medicine Give Out",
			filters={"parent": name},
			fields=LONG_ACTING_GIVE_OUT_FIELDS,
			order_by="date desc, time desc, creation desc",
		)

	today = getdate()
	next_run = _safe_getdate(data.get("next_run_date"))
	give_outs = data.get("give_outs") or []
	# Child rows arrive in insertion order (oldest first on migrated records), so sort a
	# copy before reading "the last give-out" instead of trusting give_outs[0].
	ordered_give_outs = sorted(
		give_outs,
		key=lambda row: (
			str(_row_field(row, "date") or _row_field(row, "scheduled_run_date") or ""),
			str(_row_field(row, "time") or ""),
			str(_row_field(row, "creation") or ""),
		),
		reverse=True,
	)
	last_row = ordered_give_outs[0] if ordered_give_outs else None

	data["last_give_out_date"] = _row_field(last_row, "date")
	data["last_give_out_time"] = _row_field(last_row, "time")
	data["last_give_out_by"] = _row_field(last_row, "user")
	# Side of the most recent injection: stored field first, else the give-out history.
	last_side = _last_injection_side(give_outs)
	data["last_injection_side"] = last_side
	if not _normalize_injection_given_on(data.get("injection_given_on")):
		data["injection_given_on"] = last_side
	data["is_given_out_for_current_run"] = bool(
		next_run
		and any(
			_safe_getdate(_row_field(row, "scheduled_run_date")) == next_run for row in give_outs
		)
	)
	# Give out only for the first dose on this document. Later due dates require a
	# new doctor order via Duplicate (nurse must not give from the old order).
	has_prior_give_out = bool(give_outs)
	data["can_give_out"] = bool(
		user_can_give_out_long_acting_medicine()
		and next_run
		and next_run <= today
		and not has_prior_give_out
		and not data["is_given_out_for_current_run"]
		and _active_long_acting_status(data.get("status"))
	)
	data["can_duplicate_for_next_run"] = bool(
		user_can_duplicate_long_acting_medicine()
		and next_run
		and next_run <= today
		and has_prior_give_out
		and _active_long_acting_status(data.get("status"))
	)
	data["can_stop"] = bool(
		user_can_give_out_long_acting_medicine()
		and data.get("status") in (None, "", "Active", "Draft", "Paused")
	)

	medication_label = None
	for med in data.get("medications") or []:
		medication_label = _medication_display_label(
			_row_field(med, "drug_name"),
			_row_field(med, "old_medication_name"),
		)
		if medication_label:
			break
	if not medication_label and name:
		medication_label = _first_medication_labels_for_parents([name]).get(name)
	data["medication_label"] = medication_label

	default_dosage = None
	default_uom = None
	default_dosage_form = None
	for med in data.get("medications") or []:
		if isinstance(med, dict):
			uom = _resolve_uom_for_plan_item(med)
			med["uom"] = uom
		dose_fields = _plan_item_dose_fields(med)
		if dose_fields["dose"] or dose_fields["uom"] or dose_fields["dose_term"]:
			default_dosage = dose_fields["dose"]
			default_uom = dose_fields["uom"]
			default_dosage_form = (_row_field(med, "dosage_form") or "").strip() or None
			break
	data["default_dosage"] = default_dosage
	data["default_uom"] = default_uom
	data["default_dosage_form"] = default_dosage_form

	# Detail view: same doctors_remark fallback as the list (linked Rx instructions).
	if name and not (data.get("doctors_remark") or "").strip():
		fallback = _doctors_remark_from_linked_prescription([name]).get(name)
		if fallback:
			data["doctors_remark"] = fallback

	return data


def _doctors_remark_from_linked_prescription(parent_names):
	"""For older LAMs with empty Doctors Remark: show prescription line Instructions.

	Looks at the plan-item ``instructions`` first, then the linked
	``Inpatient Medication Order Entry.instructions`` when the LAM was created
	from a Patient Medication Order. Reception ``remarks`` stays separate.
	"""
	if not parent_names:
		return {}

	remarks: dict[str, str] = {}
	plan_rows = frappe.get_all(
		"Subscription Medication Plan Item",
		filters={"parent": ["in", list(parent_names)]},
		fields=["parent", "instructions", "medication_order_entry", "idx"],
		order_by="parent asc, idx asc",
	)
	entry_names: list[str] = []
	for row in plan_rows:
		parent = row.parent
		if parent in remarks:
			continue
		text = (row.instructions or "").strip()
		if text:
			remarks[parent] = text
			continue
		entry = (row.medication_order_entry or "").strip()
		if entry:
			entry_names.append(entry)

	entry_instructions: dict[str, str] = {}
	if entry_names:
		for erow in frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={"name": ["in", list(set(entry_names))]},
			fields=["name", "instructions"],
		):
			text = (erow.instructions or "").strip()
			if text:
				entry_instructions[erow.name] = text

	if entry_instructions:
		for row in plan_rows:
			parent = row.parent
			if parent in remarks:
				continue
			entry = (row.medication_order_entry or "").strip()
			if entry and entry in entry_instructions:
				remarks[parent] = entry_instructions[entry]

	return remarks


def enrich_long_acting_medicine_list_rows(rows):
	if not rows:
		return rows

	names = [row["name"] for row in rows if row.get("name")]
	give_out_rows = []
	if names:
		give_out_rows = frappe.get_all(
			"Long Acting Medicine Give Out",
			filters={"parent": ["in", names]},
			fields=[
				"parent",
				"date",
				"time",
				"user",
				"scheduled_run_date",
				"creation",
				"rt_flag",
				"lt_flag",
			],
			order_by="date desc, time desc, creation desc",
		)

	by_parent = {}
	for row in give_out_rows:
		by_parent.setdefault(row.parent, []).append(row)

	medication_labels = _first_medication_labels_for_parents(names)
	medication_defaults = _first_medication_doses_for_parents(names)
	# Older records often left Doctors Remark blank while Instructions lived on
	# the linked prescription line — surface those in the Doctors Remark column.
	needs_doctors_remark = [
		row["name"]
		for row in rows
		if row.get("name") and not (row.get("doctors_remark") or "").strip()
	]
	prescription_doctors_remarks = _doctors_remark_from_linked_prescription(needs_doctors_remark)
	practitioner_ids = list(
		{
			(row.get("practitioner") or "").strip()
			for row in rows
			if (row.get("practitioner") or "").strip()
		}
	)
	practitioner_names = {}
	if practitioner_ids:
		from healthcare.api.common import get_practitioner_name_map

		practitioner_names = get_practitioner_name_map(practitioner_ids)

	today = getdate()
	can_give = user_can_give_out_long_acting_medicine()
	can_duplicate = user_can_duplicate_long_acting_medicine()
	enriched = []
	for row in rows:
		item = dict(row)
		parent_give_outs = by_parent.get(item["name"], [])
		last_row = parent_give_outs[0] if parent_give_outs else None
		next_run = _safe_getdate(item.get("next_run_date"))
		is_given = bool(
			next_run
			and any(_safe_getdate(go.scheduled_run_date) == next_run for go in parent_give_outs)
		)
		has_prior_give_out = bool(parent_give_outs)
		item["last_give_out_date"] = last_row.date if last_row else None
		item["last_give_out_time"] = last_row.time if last_row else None
		item["last_give_out_by"] = last_row.user if last_row else None
		# The legacy register stores the side per injection (RT_FLAG / LT_FLAG);
		# the nurse must see the previous side to alternate. Fall back to the
		# give-out history when the stored field is empty (imported records).
		last_side = _last_injection_side(parent_give_outs)
		item["last_injection_side"] = last_side
		if not _normalize_injection_given_on(item.get("injection_given_on")):
			item["injection_given_on"] = last_side
		item["is_given_out_for_current_run"] = is_given
		item["can_give_out"] = bool(
			can_give
			and next_run
			and next_run <= today
			and not has_prior_give_out
			and not is_given
			and _active_long_acting_status(item.get("status"))
		)
		item["can_duplicate_for_next_run"] = bool(
			can_duplicate
			and next_run
			and next_run <= today
			and has_prior_give_out
			and _active_long_acting_status(item.get("status"))
		)
		item["can_stop"] = bool(
			can_give
			and item.get("status") in (None, "", "Active", "Draft", "Paused")
		)
		item["medication_label"] = medication_labels.get(item["name"])
		plan_defaults = medication_defaults.get(item["name"]) or {}
		item["default_dosage"] = plan_defaults.get("default_dosage")
		item["default_uom"] = plan_defaults.get("default_uom")
		item["default_dosage_form"] = plan_defaults.get("default_dosage_form")
		pract_id = (item.get("practitioner") or "").strip()
		if pract_id:
			item["practitioner_name"] = practitioner_names.get(pract_id) or pract_id
		if not (item.get("doctors_remark") or "").strip():
			fallback = prescription_doctors_remarks.get(item["name"])
			if fallback:
				item["doctors_remark"] = fallback
		enriched.append(item)
	return enriched


class LongActingMedicine(Document):
	pass


def _sanitize_plan_item_dosage_forms(doc) -> None:
	"""Clear child dosage_form values that are not valid Pharmaceutical Form links.

	Plan items were migrated from Dosage Form → Pharmaceutical Form. Give-out / stop
	save the whole submitted document; an orphan legacy value would block those actions.
	"""
	if not frappe.db.exists("DocType", "Pharmaceutical Form"):
		return
	for med in doc.get("medications") or []:
		value = (_row_field(med, "dosage_form") or "").strip()
		if not value:
			continue
		if frappe.db.exists("Pharmaceutical Form", value):
			continue
		if isinstance(med, dict):
			med["dosage_form"] = None
		else:
			med.dosage_form = None


@frappe.whitelist()
def record_long_acting_medicine_give_out(
	name, notes=None, dose=None, dose_term=None, injection_given_on=None
):
	"""Record a give-out for the current scheduled run and advance next_run_date."""
	if not name:
		frappe.throw(_("Long Acting Medicine is required"))
	if not user_can_give_out_long_acting_medicine():
		frappe.throw(_("Only nurses and doctors can record give-outs."), frappe.PermissionError)

	injection_side = _normalize_injection_given_on(injection_given_on)
	if not injection_side:
		frappe.throw(_("Please select injection side (Left or Right)"))

	doc = frappe.get_doc("Long Acting Medicine", name)
	_sanitize_plan_item_dosage_forms(doc)
	if doc.docstatus == 2:
		frappe.throw(_("Cannot give out a cancelled Long Acting Medicine"))

	if not doc.next_run_date:
		frappe.throw(_("Next Run Date is not set on this long acting medicine"))

	scheduled_run_date = getdate(doc.next_run_date)
	today = getdate()
	if scheduled_run_date > today:
		frappe.throw(_("This dose is not due yet"))

	if doc.get("give_outs"):
		frappe.throw(
			_(
				"This long acting medicine was already given. "
				"A doctor must Duplicate it to create a new order for the next dose."
			)
		)

	if _has_give_out_for_scheduled_date(doc, scheduled_run_date):
		frappe.throw(_("This scheduled run has already been given out"))

	med_fields = _first_medication_give_out_fields(doc)
	if dose is not None:
		med_fields["dose"] = (dose or "").strip() or None
	if dose_term is not None:
		med_fields["dose_term"] = (dose_term or "").strip() or None
	give_out_row = {
		"date": today,
		"time": nowtime(),
		"scheduled_run_date": scheduled_run_date,
		"user": frappe.session.user,
		"notes": (notes or "").strip() or None,
	}
	for key, value in med_fields.items():
		if value:
			give_out_row[key] = value

	for key, value in _injection_flags_from_side(injection_side).items():
		if value:
			give_out_row[key] = value

	doc.append("give_outs", give_out_row)
	doc.injection_given_on = injection_side

	interval_days = _long_acting_frequency_interval_days(doc.frequency)
	doc.next_run_date = add_days(scheduled_run_date, interval_days)
	if doc.status in (None, "", "Draft"):
		doc.status = "Active"

	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return enrich_long_acting_medicine_row(doc)


@frappe.whitelist()
def stop_long_acting_medicine(name, reason=None):
	"""Stop an active long acting medicine subscription (no further doses scheduled)."""
	if not name:
		frappe.throw(_("Long Acting Medicine is required"))
	if not user_can_give_out_long_acting_medicine():
		frappe.throw(_("Only nurses and doctors can stop long acting medicine."), frappe.PermissionError)

	doc = frappe.get_doc("Long Acting Medicine", name)
	_sanitize_plan_item_dosage_forms(doc)
	if doc.docstatus == 2:
		frappe.throw(_("Cannot stop a cancelled Long Acting Medicine"))

	if doc.status in ("Completed",):
		frappe.throw(_("This long acting medicine is already stopped"))

	today = getdate()
	doc.status = "Completed"
	doc.end_date = today
	stop_note = (reason or "").strip()
	if stop_note:
		existing = (doc.doctors_remark or "").strip()
		stop_line = _("Stopped on {0}: {1}").format(today, stop_note)
		doc.doctors_remark = f"{existing}\n{stop_line}".strip() if existing else stop_line

	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return enrich_long_acting_medicine_row(doc)


@frappe.whitelist()
def get_long_acting_medicine_give_outs(name):
	"""Return give-out rows for one Long Acting Medicine."""
	if not name:
		frappe.throw(_("Long Acting Medicine is required"))
	return frappe.get_all(
		"Long Acting Medicine Give Out",
		filters={"parent": name},
		fields=LONG_ACTING_GIVE_OUT_FIELDS,
		order_by="date desc, time desc, creation desc",
	)


@frappe.whitelist()
def get_long_acting_give_outs_for_patient(patient=None, limit=200):
	"""Merged give-out history across long-acting medicines, latest first.

	Scoped to one patient when ``patient`` is given; otherwise across all
	patients (for the cross-patient reception / doctor list view)."""
	go_filters = {"parenttype": "Long Acting Medicine"}
	if patient:
		parents = frappe.get_all("Long Acting Medicine", filters={"patient": patient}, pluck="name")
		if not parents:
			return []
		go_filters["parent"] = ["in", parents]
	rows = frappe.get_all(
		"Long Acting Medicine Give Out",
		filters=go_filters,
		fields=LONG_ACTING_GIVE_OUT_FIELDS + ["parent"],
		order_by="date desc, time desc, creation desc",
		limit=cint(limit) or 200,
	)
	if not rows:
		return []
	parent_names = list({r.get("parent") for r in rows if r.get("parent")})
	labels = _first_medication_labels_for_parents(parent_names)
	pat_map = {}
	for lam in frappe.get_all(
		"Long Acting Medicine", filters={"name": ["in", parent_names]}, fields=["name", "patient", "patient_name"]
	):
		pat_map[lam.name] = (lam.patient, lam.patient_name)
	for r in rows:
		r["medicine"] = r.get("parent")
		r["medicine_label"] = labels.get(r.get("parent")) or r.get("medication") or r.get("parent")
		pat, pat_name = pat_map.get(r.get("parent")) or (None, None)
		r["patient"] = pat
		r["patient_name"] = pat_name or pat
	return rows
