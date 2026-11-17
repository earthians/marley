# Copyright (c) 2026, healthcare contributors
"""Auto-stop new-system IP Patient Medication Order lines past end date.

Daily job — **only** prescriptions that are:
- ``new_system = 1``
- ``legacy = 0``
- ``care_context = Inpatient Admission`` (IP medicines)

Legacy / OP / visit prescriptions are left untouched. Matching active lines
with ``end_date`` on or before today are Stopped / Discontinued with reason
"Automatic stoppage due to end date", attributed to the doctor who ordered the
line (``healthcare_practitioner`` on the row, else the parent practitioner).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr, getdate, nowdate

AUTO_STOP_REASON = "Automatic stoppage due to end date"


def auto_stop_medication_orders_past_end_date(as_of_date=None, batch_size: int = 200) -> dict:
	"""Daily scheduler: stop new-system IP medication lines past their end date."""
	today = getdate(as_of_date or nowdate())
	rows = _expired_active_entries(today)
	if not rows:
		return {"checked_on": str(today), "stopped": 0, "orders": []}

	stopped = 0
	touched_orders: set[str] = set()
	batch_size = max(1, cint(batch_size) or 200)
	pending_in_batch = 0

	for row in rows:
		if not _stop_entry(row, today):
			continue
		stopped += 1
		pending_in_batch += 1
		if row.parent:
			touched_orders.add(row.parent)
		if pending_in_batch >= batch_size:
			frappe.db.commit()
			pending_in_batch = 0

	if pending_in_batch:
		frappe.db.commit()

	return {
		"checked_on": str(today),
		"stopped": stopped,
		"orders": sorted(touched_orders),
	}


@frappe.whitelist()
def run_medication_auto_stop_now(as_of_date=None) -> dict:
	"""Manual trigger (Administrator / Healthcare Administrator)."""
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"Administrator", "System Manager", "Healthcare Administrator"}:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return auto_stop_medication_orders_past_end_date(as_of_date=as_of_date)


def _expired_active_entries(today):
	"""Active new-system IP child rows whose end_date is today or earlier.

	Excludes legacy medicines and anything that is not an Inpatient Admission
	prescription on the new system.
	"""
	from frappe.query_builder.functions import IfNull

	Entry = frappe.qb.DocType("Inpatient Medication Order Entry")
	Order = frappe.qb.DocType("Patient Medication Order")

	query = (
		frappe.qb.from_(Entry)
		.inner_join(Order)
		.on(Order.name == Entry.parent)
		.select(
			Entry.name,
			Entry.parent,
			Entry.end_date,
			Entry.drug,
			Entry.drug_name,
			Entry.healthcare_practitioner,
			Entry.stopped,
			Entry.medication_status,
			Entry.reason_stopped,
			Order.patient,
			Order.practitioner,
			Order.healthcare_practitioner.as_("order_healthcare_practitioner"),
			Order.legacy,
			Order.new_system,
			Order.care_context,
		)
		.where(Entry.parenttype == "Patient Medication Order")
		.where(Order.docstatus < 2)
		.where(IfNull(Order.legacy, 0) == 0)
		.where(IfNull(Order.new_system, 0) == 1)
		.where(Order.care_context == "Inpatient Admission")
		.where(Entry.end_date.isnotnull())
		.where(Entry.end_date <= today)
		.where(IfNull(Entry.stopped, 0) == 0)
		.where((Entry.medication_status.isnull()) | (Entry.medication_status != "Discontinued"))
	)
	return query.run(as_dict=True)


def _ordering_practitioner(row) -> str | None:
	"""Doctor who created / ordered the line — preferred for ``stoped_by``."""
	for value in (
		row.get("healthcare_practitioner"),
		row.get("order_healthcare_practitioner"),
		row.get("practitioner"),
	):
		hp = cstr(value or "").strip()
		if hp:
			return hp
	return None


def _stop_entry(row, today) -> bool:
	"""Mark one line stopped. Returns True when an update was applied."""
	entry_name = row.name
	if not entry_name:
		return False

	# Re-check — concurrent doctor discontinue may have won the race.
	current = frappe.db.get_value(
		"Inpatient Medication Order Entry",
		entry_name,
		["stopped", "medication_status", "reason_stopped", "end_date"],
		as_dict=True,
	)
	if not current:
		return False
	if cint(current.stopped) or cstr(current.medication_status or "").strip() == "Discontinued":
		return False
	if not current.end_date or getdate(current.end_date) > today:
		return False

	from healthcare.api.patient_medication_order import _set_stopped_by

	updates = {}
	if frappe.db.has_column("Inpatient Medication Order Entry", "stopped"):
		updates["stopped"] = 1
	if frappe.db.has_column("Inpatient Medication Order Entry", "medication_status"):
		updates["medication_status"] = "Discontinued"
	if frappe.db.has_column("Inpatient Medication Order Entry", "reason_stopped"):
		updates["reason_stopped"] = AUTO_STOP_REASON
	if frappe.db.has_column("Inpatient Medication Order Entry", "stopped_date"):
		updates["stopped_date"] = today
	if frappe.db.has_column("Inpatient Medication Order Entry", "stop_by"):
		updates["stop_by"] = "Scheduler"

	if updates:
		frappe.db.set_value(
			"Inpatient Medication Order Entry",
			entry_name,
			updates,
			update_modified=True,
		)

	practitioner = _ordering_practitioner(row)
	_set_stopped_by(entry_name, practitioner=practitioner)

	_write_status_log(row, practitioner)
	return True


def _write_status_log(row, practitioner: str | None) -> None:
	if not frappe.db.exists("DocType", "Medication Status Log"):
		return
	if not row.parent:
		return

	log = frappe.new_doc("Medication Status Log")
	log.patient_medication_order = row.parent
	log.medication_entry = row.name
	log.patient = row.get("patient")
	log.drug = row.get("drug")
	log.drug_name = row.get("drug_name")
	log.action = "Discontinue"
	log.new_status = "Discontinued"
	log.reason = AUTO_STOP_REASON
	# Owner stays as the scheduler user (usually Administrator); attribution
	# of who ordered the drug is on the line's stoped_by field.
	if practitioner and log.meta.has_field("practitioner"):
		log.practitioner = practitioner
	log.insert(ignore_permissions=True)
