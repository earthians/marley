"""Keep ECT Procedure in sync with ECT Details.

ECT Details is the legacy write target (Oracle import / reconcile / portal).
ECT Procedure is the long-term doctype. Every save of ECT Details upserts the
matching ECT Procedure so both stay aligned until ECT Details is retired.

The Healthcare Settings “Transfer ECT Details → ECT Procedure” button still
backfills older rows that never got a Procedure. ``source_ect_details`` (and
``trans_num`` as a fallback) stop duplicates on re-run.

Every ECT Details field that also exists on ECT Procedure is copied verbatim;
the misspelled ``succinycholine_detail`` is mapped to the corrected target
field ``succinylcholine_detail``. ``no_of_session`` and ``date_of_session`` are
derived when creating a Procedure that does not already carry them.
"""

from __future__ import annotations

import datetime

import frappe
from frappe import _

SOURCE_DOCTYPE = "ECT Details"
TARGET_DOCTYPE = "ECT Procedure"

TRANSFER_BATCH_SIZE = 500

# Layout-only fieldtypes are never copied.
_LAYOUT_FIELDTYPES = {"Section Break", "Column Break", "Tab Break", "Heading", "Fold"}

# ECT Details fieldname -> ECT Procedure fieldname where the names differ.
_FIELD_RENAME = {
	"succinycholine_detail": "succinylcholine_detail",
}

# Child table -> the child row fields copied across (both sides share names).
_CHILD_TABLE_FIELDS = {
	"ect_details_attributes": (
		"attribute",
		"attrib_num",
		"order_of_attrib",
		"att_notes",
		"cr_id",
		"cr_date",
		"up_id",
		"up_date",
	),
}


def _require_admin():
	frappe.only_for(("System Manager", "Healthcare Administrator"))


def _coerce(value, fieldtype: str | None = None):
	"""Make legacy values safe to assign to their target field."""
	if isinstance(value, datetime.datetime):
		if fieldtype == "Date":
			return value.date().isoformat()
		if fieldtype == "Time":
			return value.strftime("%H:%M:%S")
		return str(value)
	if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
		return value.isoformat()
	if isinstance(value, datetime.time):
		return value.strftime("%H:%M:%S")
	if isinstance(value, datetime.timedelta):
		# MySQL TIME columns reject raw second counts like "39780".
		total = int(value.total_seconds()) % (24 * 3600)
		hours, rem = divmod(abs(total), 3600)
		minutes, seconds = divmod(rem, 60)
		return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
	return value


def _build_procedure_fields(src, *, include_empty: bool = False) -> dict:
	"""Copy every compatible ECT Details field onto ECT Procedure fieldnames."""
	src_meta = frappe.get_meta(SOURCE_DOCTYPE)
	target_meta = frappe.get_meta(TARGET_DOCTYPE)
	fields: dict = {}

	for df in src_meta.fields:
		if df.fieldtype in _LAYOUT_FIELDTYPES or df.fieldtype == "Table":
			continue
		target = _FIELD_RENAME.get(df.fieldname, df.fieldname)
		if not target_meta.has_field(target):
			continue
		target_df = target_meta.get_field(target)
		value = _coerce(
			src.get(df.fieldname),
			(target_df.fieldtype if target_df else None) or df.fieldtype,
		)
		if value in (None, "") and not include_empty:
			continue
		fields[target] = value

	# Child tables (ECT Details Attributes) → matching target child table.
	# Always include the key on sync so emptied children clear on the Procedure.
	for child_field, keys in _CHILD_TABLE_FIELDS.items():
		if not target_meta.has_field(child_field):
			continue
		child_meta = frappe.get_meta(target_meta.get_field(child_field).options)
		rows = []
		for row in src.get(child_field) or []:
			payload = {}
			for key in keys:
				child_df = child_meta.get_field(key) if child_meta else None
				payload[key] = _coerce(
					row.get(key), child_df.fieldtype if child_df else None
				)
			rows.append(payload)
		if rows or include_empty:
			fields[child_field] = rows

	return fields


def _next_session_no(patient: str) -> int:
	return frappe.db.count(TARGET_DOCTYPE, {"patient": patient}) + 1


def _find_linked_procedure(src) -> str | None:
	"""Existing ECT Procedure for this ECT Details row, if any."""
	target_meta = frappe.get_meta(TARGET_DOCTYPE)
	if target_meta.has_field("source_ect_details") and src.get("name"):
		name = frappe.db.get_value(
			TARGET_DOCTYPE, {"source_ect_details": src.name}, "name"
		)
		if name:
			return name
	trans_num = (src.get("trans_num") or "").strip()
	if trans_num and target_meta.has_field("trans_num"):
		return frappe.db.get_value(TARGET_DOCTYPE, {"trans_num": trans_num}, "name")
	return None


def _apply_procedure_fields(doc, fields: dict) -> None:
	"""Set scalar + child-table values from a ``_build_procedure_fields`` payload."""
	for key, value in fields.items():
		if key in _CHILD_TABLE_FIELDS:
			doc.set(key, [])
			for row in value or []:
				doc.append(key, row)
			continue
		doc.set(key, value)


def sync_procedure_from_details(src) -> dict:
	"""Create or update the ECT Procedure that mirrors one ECT Details row.

	Called from ``ECT Details.on_update`` so imports, reconciles, attribute
	loads and portal saves all keep ECT Procedure current.
	"""
	if not frappe.db.exists("DocType", TARGET_DOCTYPE):
		return {"status": "skipped", "reason": "no_procedure_doctype"}

	if isinstance(src, str):
		src = frappe.get_doc(SOURCE_DOCTYPE, src)

	if not src.get("patient"):
		return {"status": "skipped", "reason": "no_patient", "source": src.get("name")}

	target_meta = frappe.get_meta(TARGET_DOCTYPE)
	has_source_field = target_meta.has_field("source_ect_details")
	existing = _find_linked_procedure(src)

	# On update, clear emptied fields too so Procedure mirrors Details.
	fields = _build_procedure_fields(src, include_empty=bool(existing))
	fields["patient"] = src.patient
	if target_meta.has_field("patient_name") and not fields.get("patient_name"):
		fields["patient_name"] = frappe.db.get_value("Patient", src.patient, "patient_name")
	if has_source_field:
		fields["source_ect_details"] = src.name

	if existing:
		doc = frappe.get_doc(TARGET_DOCTYPE, existing)
		_apply_procedure_fields(doc, fields)
		doc.flags.ignore_mandatory = True
		doc.flags.ignore_links = True
		doc.flags.ignore_validate = True
		doc.save(ignore_permissions=True)
		return {"status": "updated", "name": doc.name, "source": src.name}

	if target_meta.has_field("no_of_session") and not fields.get("no_of_session"):
		fields["no_of_session"] = _next_session_no(src.patient)
	if target_meta.has_field("date_of_session") and not fields.get("date_of_session"):
		fields["date_of_session"] = _coerce(src.get("date"))

	doc = frappe.get_doc({"doctype": TARGET_DOCTYPE, **fields})
	doc.flags.ignore_mandatory = True
	doc.flags.ignore_links = True
	doc.flags.ignore_validate = True
	doc.insert(ignore_permissions=True)

	return {"status": "created", "name": doc.name, "source": src.name}


def transfer_one(ect_detail_name: str) -> dict:
	"""Upsert one ECT Procedure from a single ECT Details row (idempotent)."""
	result = sync_procedure_from_details(ect_detail_name)
	if result.get("status") == "skipped":
		return result
	return result


@frappe.whitelist()
def preview_ect_details_to_procedure_transfer() -> dict:
	"""Return counts used by the Healthcare Settings confirmation dialog."""
	_require_admin()

	total = frappe.db.count(SOURCE_DOCTYPE)
	with_patient = frappe.db.count(SOURCE_DOCTYPE, {"patient": ["is", "set"]})
	already = 0
	if frappe.get_meta(TARGET_DOCTYPE).has_field("source_ect_details"):
		already = frappe.db.count(TARGET_DOCTYPE, {"source_ect_details": ["is", "set"]})

	return {
		"total_details": total,
		"with_patient": with_patient,
		"already_transferred": already,
		"pending": max(total - already, 0),
	}


def run_ect_details_to_procedure_transfer_batch(*, offset: int = 0) -> dict:
	name_rows = frappe.get_all(
		SOURCE_DOCTYPE,
		fields=["name"],
		order_by="creation asc, name asc",
		limit=TRANSFER_BATCH_SIZE,
		limit_start=offset,
	)
	names = [row["name"] for row in name_rows]
	if not names:
		return {
			"processed": offset,
			"done": True,
			"batch_count": 0,
			"created": 0,
			"updated": 0,
			"skipped": 0,
			"errors": 0,
		}

	created = updated = skipped = errors = 0
	for name in names:
		try:
			result = transfer_one(name)
			status = result.get("status")
			if status == "created":
				created += 1
			elif status == "updated":
				updated += 1
			else:
				skipped += 1
		except Exception:
			errors += 1
			frappe.log_error(
				title=f"ECT Details → ECT Procedure transfer failed: {name}",
				message=frappe.get_traceback(),
			)

	frappe.db.commit()
	processed = offset + len(names)
	return {
		"processed": processed,
		"done": len(names) < TRANSFER_BATCH_SIZE,
		"batch_count": len(names),
		"created": created,
		"updated": updated,
		"skipped": skipped,
		"errors": errors,
	}
