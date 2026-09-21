# Copyright (c) 2026, Healthcare contributors
"""Portal API: the patient's own documents / signatures across every doctype.

Only documents belonging to the patient are listed — doctor, nurse and other staff
signatures plus clinical result attachments are excluded:

* ``Patient Upload Document`` child rows on Patient, Patient Visit, Inpatient
  Admission (``e_signatures``), Discharge and Lab Test
* ``IP Patient Relative`` signatures captured with an admission / discharge
* patient-owned file fields (signed consents, patient/guardian signatures, patient
  profile photos, CPR scans)
* ``File`` rows attached directly to the Patient / visit / admission / discharge / lab test

Legacy Visit Documents are **not** included here — Patient History shows them in its
own "Legacy Documents" section. ``get_patient_documents`` reads the doctype metadata so
a newly added patient upload/signature field is picked up automatically.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr

MAX_ROWS = 500
# Cap resolved document names so ``IN (...)`` filters stay small.
MAX_NAMES = 500

_DATE_FIELDS = ("date_created", "date", "posting_date", "creation")

# Friendly labels for the child-table stores: (child doctype, parent doctype, parentfield)
_CHILD_SOURCE_LABELS = {
	("Patient Upload Document", "Patient", "patient_document"): "Patient Document",
	("Patient Upload Document", "Patient Visit", "documents"): "Patient Visit Document",
	("Patient Upload Document", "Inpatient Admission", "e_signatures"): "Admission e-Signature",
	("Patient Upload Document", "Discharge", "patient_documents"): "Discharge Document",
	("Patient Upload Document", "Lab Test", "documents"): "Lab Test Document",
	("IP Patient Relative", "Inpatient Admission", "patient_relatives"): "Admission Relative Signature",
	("IP Patient Relative", "Discharge", "patient_relatives"): "Discharge Relative Signature",
}

# Documents whose directly attached ``File`` rows are also listed.
_FILE_CONTAINER_DOCTYPES = (
	"Patient",
	"Patient Visit",
	"Inpatient Admission",
	"Discharge",
	"Lab Test",
)

# Child stores that only hold the patient's own uploads / signatures.
_PATIENT_DOCUMENT_CHILD_DOCTYPES = ("Patient Upload Document", "IP Patient Relative")

# Doctypes whose file fields are the patient's own (profile photo, passport, CPR scans).
_PATIENT_OWNED_DOCTYPES = ("Patient",)

# Explicit patient-side file fields that do not contain a patient/client hint.
_PATIENT_OWNED_FIELD_NAMES = {"signed_document", "signee_signature"}

# A field belongs to the patient when its name/label mentions one of these.
_PATIENT_OWNED_FIELD_HINTS = ("patient", "client", "guardian", "signee")


def _patient_owned_field(fieldname: str, label: str = "") -> bool:
	"""True when a file field stores the patient's own document / signature.

	Doctor, nurse and other staff signatures (``doctors_signature``,
	``psychiatrist_signature``, ``staff_signature`` …), clinical result attachments and
	generic form signatures are deliberately excluded.
	"""
	name = (fieldname or "").strip().lower()
	if not name:
		return False
	if name in _PATIENT_OWNED_FIELD_NAMES:
		return True
	if any(hint in name for hint in _PATIENT_OWNED_FIELD_HINTS):
		return True
	label_text = (label or "").strip().lower()
	return "patient" in label_text or "client" in label_text


def _meta_rows(sql: str, values: dict | None = None) -> list[dict]:
	if values is None:
		return frappe.db.sql(query=sql, as_dict=True)
	return frappe.db.sql(query=sql, values=values, as_dict=True)


def _table_columns(doctype: str) -> set[str]:
	"""Physical columns of ``doctype``; empty when it has no table (Single / virtual)."""
	try:
		return set(frappe.db.get_table_columns(doctype))
	except (frappe.db.TableMissingError, frappe.db.ProgrammingError):
		return set()


def _file_fields(istable: int) -> dict[str, list[tuple[str, str]]]:
	"""``{doctype: [(fieldname, label)]}`` for Attach / Attach Image fields."""
	rows = _meta_rows(
		f"""
		SELECT df.parent AS doctype, df.fieldname,
			IFNULL(NULLIF(df.label, ''), df.fieldname) AS label
		FROM `tabDocField` df
		JOIN `tabDocType` dt ON dt.name = df.parent
		WHERE dt.istable = {int(istable)} AND dt.issingle = 0
			AND df.fieldtype IN ('Attach', 'Attach Image')
		"""
	)
	out: dict[str, list[tuple[str, str]]] = {}
	for row in rows:
		out.setdefault(row["doctype"], []).append((row["fieldname"], row["label"]))
	return out


def _patient_link_fields() -> dict[str, str]:
	"""``{doctype: fieldname}`` for doctypes linking to Patient."""
	rows = _meta_rows(
		"""
		SELECT df.parent AS doctype, df.fieldname
		FROM `tabDocField` df
		JOIN `tabDocType` dt ON dt.name = df.parent
		WHERE df.fieldtype = 'Link' AND df.options = 'Patient' AND dt.issingle = 0
		"""
	)
	return {row["doctype"]: row["fieldname"] for row in rows}


def _link_fields() -> dict[str, list[tuple[str, str]]]:
	"""``{doctype: [(fieldname, options)]}`` for every Link field."""
	rows = _meta_rows(
		"""
		SELECT df.parent AS doctype, df.fieldname, df.options
		FROM `tabDocField` df
		JOIN `tabDocType` dt ON dt.name = df.parent
		WHERE df.fieldtype = 'Link' AND IFNULL(df.options, '') <> '' AND dt.issingle = 0
		"""
	)
	out: dict[str, list[tuple[str, str]]] = {}
	for row in rows:
		out.setdefault(row["doctype"], []).append((row["fieldname"], row["options"]))
	return out


def _table_fields(child_doctypes) -> dict[str, list[tuple[str, str]]]:
	"""``{child doctype: [(parent doctype, fieldname)]}`` for Table fields."""
	children = [cstr(c).strip() for c in child_doctypes if cstr(c).strip()]
	if not children:
		return {}
	rows = _meta_rows(
		"""
		SELECT parent AS parent_doctype, fieldname, options AS child_doctype
		FROM `tabDocField`
		WHERE fieldtype = 'Table' AND options IN %(children)s
		""",
		{"children": tuple(children)},
	)
	out: dict[str, list[tuple[str, str]]] = {}
	for row in rows:
		out.setdefault(row["child_doctype"], []).append((row["parent_doctype"], row["fieldname"]))
	return out


def _resolve_doc_names(
	doctype: str,
	patient: str,
	cache: dict[str, list[str]],
	patient_link_fields: dict[str, str],
	link_fields: dict[str, list[tuple[str, str]]],
) -> list[str]:
	"""Names of ``doctype`` rows belonging to ``patient``.

	Uses the direct ``patient`` link when the doctype has one; otherwise follows a
	single link hop to a patient-linked doctype (e.g. Discharge → Inpatient
	Admission → Patient). One hop covers every document container in this app and
	keeps the number of queries small.
	"""
	if doctype in cache:
		return cache[doctype]

	patient_field = patient_link_fields.get(doctype)
	if patient_field:
		names = frappe.get_all(
			doctype,
			filters={patient_field: patient},
			pluck="name",
			limit_page_length=MAX_NAMES,
			ignore_permissions=True,
		)
		cache[doctype] = names
		return names

	names: list[str] = []
	for fieldname, options in link_fields.get(doctype) or []:
		if options not in patient_link_fields:
			continue
		parent_names = _resolve_doc_names(
			options, patient, cache, patient_link_fields, link_fields
		)
		if not parent_names:
			continue
		names.extend(
			frappe.get_all(
				doctype,
				filters={fieldname: ["in", parent_names]},
				pluck="name",
				limit_page_length=MAX_NAMES,
				ignore_permissions=True,
			)
		)
	cache[doctype] = names
	return names


def _row_date(row: dict) -> str:
	for field in _DATE_FIELDS:
		value = cstr(row.get(field)).strip()
		if value:
			return value
	return ""


def _looks_like_signature(fieldname: str, label: str, extra: str = "") -> bool:
	haystack = f"{fieldname} {label} {extra}".lower()
	return "signature" in haystack or "signee" in haystack


def _source_label(doctype: str) -> str:
	if doctype == "Legacy Visit Document":
		return "Legacy Scan"
	if doctype == "Patient":
		return "Patient Profile"
	return doctype


def _child_source_label(
	child_doctype: str, parent_doctype: str, parentfield: str | None, field_label: str
) -> str:
	key = (child_doctype, parent_doctype, cstr(parentfield))
	if key in _CHILD_SOURCE_LABELS:
		return _CHILD_SOURCE_LABELS[key]
	return f"{parent_doctype} · {field_label}"


def _entry(
	source: str,
	source_doctype: str,
	source_name: str,
	fieldname: str,
	field_label: str,
	url: str,
	when: str = "",
	is_signature: bool = False,
	extra: dict | None = None,
) -> dict:
	row = {
		"name": f"{source_doctype}::{source_name}::{fieldname}::{url}",
		"source": source,
		"source_doctype": source_doctype,
		"source_name": source_name,
		"reference": source_name,
		"fieldname": fieldname,
		"field_label": field_label,
		"document": url,
		"date": when,
		"is_signature": 1 if is_signature else 0,
	}
	if extra:
		row.update({key: value for key, value in extra.items() if value not in (None, "")})
	return row


@frappe.whitelist()
def get_patient_documents(patient=None, limit=300):
	"""Every stored document / signature for a patient, newest first.

	Aggregates Patient Upload Document child rows, Attach fields on
	patient-linked doctypes and directly attached ``File`` rows, whichever
	doctype they are stored on.
	"""
	patient = cstr(patient).strip()
	if not patient:
		return []
	if not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient not found"))

	limit = min(cint(limit) or 300, MAX_ROWS)

	patient_link_fields = _patient_link_fields()
	link_fields = _link_fields()
	direct_file_fields = _file_fields(istable=0)
	child_file_fields = _file_fields(istable=1)
	table_fields = _table_fields(child_file_fields)
	cache: dict[str, list[str]] = {}

	rows: list[dict] = []

	# 1 ─ File fields that hold the patient's own documents / signatures.
	# Legacy Visit Documents keep their own Patient History section, so skip them here.
	for doctype, fields in direct_file_fields.items():
		patient_field = patient_link_fields.get(doctype)
		if not patient_field or doctype == "Legacy Visit Document":
			continue
		if doctype in _PATIENT_OWNED_DOCTYPES:
			patient_fields = list(fields)
		else:
			patient_fields = [
				(name, label) for name, label in fields if _patient_owned_field(name, label)
			]
		if not patient_fields:
			continue
		fieldnames = [name for name, _label in patient_fields]
		labels = dict(patient_fields)
		columns = _table_columns(doctype)
		if not columns:
			continue
		date_fields = [name for name in _DATE_FIELDS if name in columns]
		docs = frappe.get_all(
			doctype,
			filters={patient_field: patient},
			or_filters=[[name, "is", "set"] for name in fieldnames],
			fields=list(dict.fromkeys(["name", *fieldnames, *date_fields])),
			limit_page_length=limit,
			ignore_permissions=True,
		)
		for doc in docs:
			for fieldname in fieldnames:
				url = cstr(doc.get(fieldname)).strip()
				if not url:
					continue
				label = labels.get(fieldname) or fieldname
				rows.append(
					_entry(
						source=_source_label(doctype),
						source_doctype=doctype,
						source_name=doc.get("name"),
						fieldname=fieldname,
						field_label=label,
						url=url,
						when=_row_date(doc),
						is_signature=_looks_like_signature(fieldname, label),
					)
				)

	# 2 ─ Attach fields in the patient's upload / signature child tables
	# (Patient Upload Document, IP Patient Relative).
	for child_doctype, fields in child_file_fields.items():
		if child_doctype not in _PATIENT_DOCUMENT_CHILD_DOCTYPES:
			continue
		fieldnames = [name for name, _label in fields]
		labels = dict(fields)
		columns = _table_columns(child_doctype)
		if not columns:
			continue
		extra_cols = [
			name
			for name in (
				"document_type",
				"file_name",
				"document_name",
				"transaction_no",
				"upload_remarks",
				"patient_relation",
				"signee_name",
			)
			if name in columns
		]
		date_fields = [name for name in _DATE_FIELDS if name in columns]
		for parent_doctype, _child_field in table_fields.get(child_doctype) or []:
			parent_names = _resolve_doc_names(
				parent_doctype, patient, cache, patient_link_fields, link_fields
			)
			if not parent_names:
				continue
			child_rows = frappe.get_all(
				child_doctype,
				filters={"parenttype": parent_doctype, "parent": ["in", parent_names]},
				fields=list(
					dict.fromkeys(
						["name", "parent", "parentfield", *fieldnames, *extra_cols, *date_fields]
					)
				),
				limit_page_length=limit,
				ignore_permissions=True,
			)
			for child in child_rows:
				for fieldname in fieldnames:
					url = cstr(child.get(fieldname)).strip()
					if not url:
						continue
					label = labels.get(fieldname) or fieldname
					rows.append(
						_entry(
							source=_child_source_label(
								child_doctype, parent_doctype, child.get("parentfield"), label
							),
							source_doctype=parent_doctype,
							source_name=child.get("parent"),
							fieldname=fieldname,
							field_label=label,
							url=url,
							when=_row_date(child),
							is_signature=_looks_like_signature(
								fieldname,
								label,
								" ".join(
									cstr(child.get(name))
									for name in ("document_type", "file_name")
								),
							),
							extra={
								"document_type": child.get("document_type"),
								"file_name": child.get("file_name"),
								"document_name": child.get("document_name"),
								"transaction_no": child.get("transaction_no"),
								"upload_remarks": child.get("upload_remarks"),
								"patient_relation": child.get("patient_relation"),
								"signee_name": child.get("signee_name"),
							},
						)
					)


	# 3 ─ Files attached straight to the patient / visit / admission / lab test.
	# Attach fields are mirrored into File rows, so skip URLs already listed above.
	stored_urls = {cstr(row.get("document")) for row in rows}
	file_columns = _table_columns("File")
	file_date_fields = [name for name in _DATE_FIELDS if name in file_columns]
	for doctype in _FILE_CONTAINER_DOCTYPES:
		if not frappe.db.exists("DocType", doctype):
			continue
		names = (
			[patient]
			if doctype == "Patient"
			else _resolve_doc_names(doctype, patient, cache, patient_link_fields, link_fields)
		)
		if not names:
			continue
		files = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": doctype,
				"attached_to_name": ["in", names],
				"is_folder": 0,
			},
			fields=list(
				dict.fromkeys(
					["name", "file_name", "file_url", "attached_to_name", *file_date_fields]
				)
			),
			limit_page_length=limit,
			ignore_permissions=True,
		)
		for file_row in files:
			url = cstr(file_row.get("file_url")).strip()
			if not url or url in stored_urls:
				continue
			rows.append(
				_entry(
					source=f"{_source_label(doctype)} Attachment",
					source_doctype=doctype,
					source_name=file_row.get("attached_to_name"),
					fieldname="attached_file",
					field_label="Attached File",
					url=url,
					when=_row_date(file_row),
					extra={"file_name": file_row.get("file_name")},
				)
			)

	# De-duplicate and order newest first.
	seen: set[str] = set()
	unique: list[dict] = []
	for row in rows:
		key = cstr(row.get("name"))
		if key in seen:
			continue
		seen.add(key)
		unique.append(row)
	unique.sort(key=lambda row: cstr(row.get("date")), reverse=True)
	return unique[:limit]

