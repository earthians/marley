# Copyright (c) 2026, Healthcare and contributors
# For license information, please see license.txt

"""Evaluate Lab Test Result Rule records against normal_test_items rows."""

from __future__ import annotations

import ast
import operator
import re
from typing import Any

import frappe
from frappe import _

_DECIMALS = 2

_ALLOWED_BINOPS = {
	ast.Add: operator.add,
	ast.Sub: operator.sub,
	ast.Mult: operator.mul,
	ast.Div: operator.truediv,
	ast.FloorDiv: operator.floordiv,
	ast.Mod: operator.mod,
	ast.Pow: operator.pow,
}
_ALLOWED_UNARYOPS = {
	ast.UAdd: operator.pos,
	ast.USub: operator.neg,
}
_ALLOWED_CALLS = {
	"min": min,
	"max": max,
}
_PATIENT_FORMULA_TOKENS = ("@Age", "@Kappa", "@Alpha")

# Operators pasted from Word/Excel/UI that are not valid Python/JS arithmetic.
_UNICODE_FORMULA_OPS = str.maketrans(
	{
		"÷": "/",
		"×": "*",
		"∙": "*",
		"∗": "*",
		"−": "-",  # U+2212 minus
		"–": "-",  # en dash
		"—": "-",  # em dash
	}
)


def normalize_formula_operators(formula: str) -> str:
	"""Map Unicode math symbols to ASCII operators the evaluator understands."""
	return (formula or "").translate(_UNICODE_FORMULA_OPS)


def _norm_key(value: str | None) -> str:
	return (value or "").strip().casefold()


def _norm_key_loose(value: str | None) -> str:
	"""Case-insensitive key with spaces stripped (T.Bilirubin == T. Bilirubin)."""
	return re.sub(r"\s+", "", (value or "").strip()).casefold()


def _parse_float(value) -> float | None:
	if value is None:
		return None
	text = re.sub(r"<[^>]+>", "", str(value)).strip()
	if not text:
		return None
	try:
		return float(text.replace(",", ""))
	except (TypeError, ValueError):
		pass
	match = re.search(r"[-+]?\d*\.?\d+", text.replace(",", ""))
	if match:
		try:
			return float(match.group())
		except (TypeError, ValueError):
			return None
	return None


def _format_sum_validation_user_message(
	labels: list[str],
	total: float,
	target: float,
	tolerance: float,
	*,
	parts: list[tuple[str, float]] | None = None,
) -> str:
	"""Short, readable message for clinicians (not a raw exception string)."""
	low = target - tolerance
	high = target + tolerance
	total_s = _format_result(total)
	target_s = _format_result(target)
	low_s = _format_result(low)
	high_s = _format_result(high)

	if parts:
		detail = " + ".join(f"{label} ({_format_result(val)})" for label, val in parts)
	elif len(labels) <= 6:
		detail = ", ".join(labels)
	else:
		detail = ", ".join(labels[:5]) + _(", and {0} more").format(len(labels) - 5)

	return _(
		"The selected differential counts add up to {total}% "
		"(they should total {target}%, acceptable range {low}%–{high}%).\n\n"
		"Only these tests from the rule child table are included:\n{tests}\n\n"
		"Other children in the group (WBC, RBC, HGB, …) are not part of this sum."
	).format(
		total=total_s,
		target=target_s,
		low=low_s,
		high=high_s,
		tests=detail,
	)


def _format_sum_validation_short_message(
	labels: list[str], total: float, target: float, tolerance: float
) -> str:
	"""One-line summary for toasts."""
	low = _format_result(target - tolerance)
	high = _format_result(target + tolerance)
	return _(
		"Differential total is {total}% (should be {target}%, range {low}%–{high}%)."
	).format(
		total=_format_result(total),
		target=_format_result(target),
		low=low,
		high=high,
	)


def _format_result(value: float) -> str:
	rounded = round(value, _DECIMALS)
	if rounded == int(rounded):
		return str(int(rounded))
	return f"{rounded:.{_DECIMALS}f}".rstrip("0").rstrip(".")


def _safe_eval_arithmetic(expr: str) -> float:
	node = ast.parse(expr.strip(), mode="eval").body
	return float(_eval_ast(node))


def _eval_ast(node):
	if isinstance(node, ast.Constant):
		if isinstance(node.value, (int, float)):
			return node.value
		raise ValueError(_("Invalid constant in formula"))
	# ast.Num removed in Python 3.12+; only reference it when present
	_ast_num = getattr(ast, "Num", None)
	if _ast_num is not None and isinstance(node, _ast_num):
		return node.n
	if isinstance(node, ast.BinOp):
		op_type = type(node.op)
		if op_type not in _ALLOWED_BINOPS:
			raise ValueError(_("Unsupported operator in formula"))
		left = _eval_ast(node.left)
		right = _eval_ast(node.right)
		return _ALLOWED_BINOPS[op_type](left, right)
	if isinstance(node, ast.UnaryOp):
		op_type = type(node.op)
		if op_type not in _ALLOWED_UNARYOPS:
			raise ValueError(_("Unsupported unary operator in formula"))
		return _ALLOWED_UNARYOPS[op_type](_eval_ast(node.operand))
	if isinstance(node, ast.Call):
		if not isinstance(node.func, ast.Name):
			raise ValueError(_("Invalid expression in formula"))
		func_name = (node.func.id or "").strip().lower()
		if func_name not in _ALLOWED_CALLS:
			raise ValueError(_("Unsupported function in formula"))
		if node.keywords or len(node.args) != 2:
			raise ValueError(_("Invalid function call in formula"))
		left = _eval_ast(node.args[0])
		right = _eval_ast(node.args[1])
		return _ALLOWED_CALLS[func_name](left, right)
	raise ValueError(_("Invalid expression in formula"))


def _aliases_from_row(row) -> list[str]:
	raw = (getattr(row, "aliases", None) or row.get("aliases") if isinstance(row, dict) else None) or ""
	return [a.strip() for a in raw.split(",") if a.strip()]


def _display_name_for_template(template: str) -> str:
	if not template:
		return ""
	if frappe.db.exists("Lab Test Template", template):
		return (
			frappe.db.get_value("Lab Test Template", template, "lab_test_name") or template
		)
	return template


def _event_names_from_rule_event(row) -> list[str]:
	"""Identifiers used to match a child test's result (template name, display name, aliases)."""
	tpl = (getattr(row, "lab_test_event", None) or row.get("lab_test_event") or "").strip()
	if not tpl:
		return []
	names = [tpl]
	display = _display_name_for_template(tpl)
	if display and display not in names:
		names.append(display)
	for alias in _aliases_from_row(row):
		if alias not in names:
			names.append(alias)
	return names


def get_group_child_templates(parent_template: str) -> list[dict[str, str]]:
	"""Child Lab Test Templates that belong to a panel (CBC, Lipid, etc.)."""
	if not parent_template or not frappe.db.exists("Lab Test Template", parent_template):
		return []

	seen: set[str] = set()
	children: list[dict[str, str]] = []

	def _add(template_name: str):
		if not template_name or template_name in seen:
			return
		seen.add(template_name)
		children.append(
			{
				"lab_test_event": template_name,
				"lab_test_name": _display_name_for_template(template_name),
			}
		)

	for row in frappe.get_all(
		"Lab Test Template",
		filters={"lab_group": parent_template, "disabled": 0},
		fields=["name"],
		order_by="lab_test_name asc",
	):
		_add(row.name)

	parent_doc = frappe.get_doc("Lab Test Template", parent_template)
	for row in parent_doc.get("lab_test_group_templates") or []:
		if (row.template_or_new_line or "").strip() == "Add Test" and row.lab_test_template:
			_add(row.lab_test_template)

	return children


def _absorb_lab_test_result_into_values(lt, values: dict[str, float], allowed_templates: set[str] | None = None) -> None:
	"""Add one Lab Test document's numeric result into the formula variable map."""
	if not lt:
		return
	tpl = (getattr(lt, "template", None) or "").strip()
	if allowed_templates and tpl and tpl not in allowed_templates:
		display_tpl = _display_name_for_template(tpl)
		lab_name = (getattr(lt, "lab_test_name", None) or "").strip()
		allowed_names = {_norm_key(t) for t in allowed_templates}
		allowed_names.update(_norm_key(_display_name_for_template(t)) for t in allowed_templates)
		if _norm_key(tpl) not in allowed_names and _norm_key(display_tpl) not in allowed_names:
			if not lab_name or _norm_key(lab_name) not in allowed_names:
				return

	val = _parse_float(getattr(lt, "custom_result", None))
	if val is None:
		for item in lt.normal_test_items or []:
			val = _parse_float(getattr(item, "result_value", None))
			if val is not None:
				break
	if val is None:
		return

	for key in filter(
		None,
		[
			tpl,
			_display_name_for_template(tpl),
			getattr(lt, "lab_test_name", None),
		],
	):
		values[key] = val


def collect_panel_result_values(
	panel_template: str,
	*,
	service_request: str | None = None,
	lab_test_group: str | None = None,
	patient: str | None = None,
	current_doc=None,
) -> dict[str, float]:
	"""Gather numeric results for all child tests in a panel (multiple linking strategies)."""
	values: dict[str, float] = {}
	if not panel_template:
		return values

	child_templates = [
		c["lab_test_event"] for c in get_group_child_templates(panel_template) if c.get("lab_test_event")
	]
	allowed = set(child_templates)
	if current_doc:
		_merge_lab_test_custom_result_into_values(current_doc, values)

	if not child_templates and not current_doc:
		return values

	seen_lab_tests: set[str] = set()

	def _absorb_name(lab_test_name: str | None, *, restrict_to_panel: bool = True):
		if not lab_test_name or lab_test_name in seen_lab_tests:
			return
		seen_lab_tests.add(lab_test_name)
		allowed_filter = (allowed or None) if restrict_to_panel else None
		_absorb_lab_test_result_into_values(
			frappe.get_doc("Lab Test", lab_test_name), values, allowed_filter
		)

	if service_request:
		# Multi-test service requests often mix singles + groups; include every
		# lab test on the request so formulas (e.g. Total Protein − Albumin) work.
		# Do not fall through to patient/group queries — they load other visits and
		# overwrite correct values (e.g. 91 − 78 = 13 instead of 20 − 78 = −58).
		for row in frappe.get_all(
			"Lab Test",
			filters={"service_request": service_request, "docstatus": ["!=", 2]},
			fields=["name"],
			order_by="modified asc",
		):
			_absorb_name(row.name, restrict_to_panel=False)
		return values

	for group_key in {k for k in (lab_test_group, panel_template) if k}:
		group_filters: dict[str, Any] = {
			"lab_test_group": group_key,
			"docstatus": ["!=", 2],
		}
		if patient:
			group_filters["patient"] = patient
		for row in frappe.get_all(
			"Lab Test",
			filters=group_filters,
			fields=["name"],
			order_by="modified asc",
		):
			_absorb_name(row.name)

	if patient:
		for tpl in child_templates:
			lt_name = frappe.db.get_value(
				"Lab Test",
				{"patient": patient, "template": tpl, "docstatus": ["!=", 2]},
				"name",
				order_by="modified desc",
			)
			if not lt_name:
				display = _display_name_for_template(tpl)
				if display:
					lt_name = frappe.db.get_value(
						"Lab Test",
						{"patient": patient, "lab_test_name": display, "docstatus": ["!=", 2]},
						"name",
						order_by="modified desc",
					)
			_absorb_name(lt_name)

	return values


def get_group_lab_test_result_values(
	service_request: str | None,
	child_templates: list[str],
	*,
	lab_test_group: str | None = None,
	patient: str | None = None,
) -> dict[str, float]:
	"""Backward-compatible wrapper — prefer collect_panel_result_values when panel is known."""
	if not child_templates:
		return {}
	panel = lab_test_group or ""
	return collect_panel_result_values(
		panel,
		service_request=service_request,
		lab_test_group=lab_test_group,
		patient=patient,
	)


def _merge_lab_test_custom_result_into_values(lab_test_doc, values: dict[str, float]) -> None:
	"""Include this Lab Test's custom_result in the variable map (portal inline entry)."""
	if not lab_test_doc:
		return
	val = _parse_float(getattr(lab_test_doc, "custom_result", None))
	if val is None:
		return
	for key in filter(
		None,
		[
			getattr(lab_test_doc, "template", None),
			_display_name_for_template(getattr(lab_test_doc, "template", None)),
			getattr(lab_test_doc, "lab_test_name", None),
		],
	):
		values[key] = val


def _template_for_event_label(label: str, panel_template: str) -> str | None:
	"""Resolve a rule event label (e.g. Globulin) to a Lab Test Template name."""
	if not label:
		return None
	label_n = _norm_key(label)
	label_loose = _norm_key_loose(label)
	for child in get_group_child_templates(panel_template):
		names = (child["lab_test_event"], child["lab_test_name"])
		if label_n in (_norm_key(n) for n in names):
			return child["lab_test_event"]
		if label_loose in (_norm_key_loose(n) for n in names):
			return child["lab_test_event"]
	if frappe.db.exists("Lab Test Template", label):
		return label
	found = frappe.db.get_value("Lab Test Template", {"lab_test_name": label}, "name")
	if found:
		return found
	for row in frappe.get_all(
		"Lab Test Template",
		filters={"disabled": 0},
		fields=["name", "lab_test_name"],
		limit=500,
	):
		if _norm_key_loose(row.lab_test_name) == label_loose or _norm_key_loose(row.name) == label_loose:
			return row.name
	return None


def _find_lab_test_for_panel_child(
	template: str,
	*,
	service_request: str | None = None,
	lab_test_group: str | None = None,
	patient: str | None = None,
	panel_template: str | None = None,
) -> str | None:
	"""Find a child Lab Test row using service request, group, or patient (try all)."""
	strategies: list[dict[str, Any]] = []
	if service_request:
		strategies.append({"service_request": service_request, "template": template})
	for group_key in {k for k in (lab_test_group, panel_template) if k}:
		strategies.append({"lab_test_group": group_key, "template": template})
	if patient:
		strategies.append({"patient": patient, "template": template})
		if panel_template:
			strategies.append({"patient": patient, "template": template, "lab_test_group": panel_template})

	for filt in strategies:
		filt["docstatus"] = ["!=", 2]
		name = frappe.db.get_value("Lab Test", filt, "name", order_by="modified desc")
		if name:
			return name

	if patient:
		display = _display_name_for_template(template)
		if display:
			return frappe.db.get_value(
				"Lab Test",
				{"patient": patient, "lab_test_name": display, "docstatus": ["!=", 2]},
				"name",
				order_by="creation desc",
			)
	return None


def _align_values_to_rule_event_names(
	values: dict[str, float],
	rules: dict[str, Any],
	service_request: str | None = None,
) -> None:
	"""Copy numeric results onto rule event labels so formulas match (e.g. TOTAL PROTEIN)."""
	by_norm = {_norm_key(k): v for k, v in values.items() if k}
	by_loose = {_norm_key_loose(k): v for k, v in values.items() if k}
	panel_template = (rules.get("lab_test_template") or "").strip()

	def _copy_to_label(label: str):
		if not label or label in values:
			return
		val = by_norm.get(_norm_key(label))
		if val is None:
			val = by_loose.get(_norm_key_loose(label))
		if val is not None:
			values[label] = val

	for row in rules.get("sum_events") or []:
		for nm in _event_names_from_rule_event(row):
			_copy_to_label(nm)

	for line in rules.get("rule_lines") or []:
		for nm in (
			line.get("target_event"),
			line.get("numerator_event"),
			line.get("denominator_event"),
		):
			_copy_to_label((nm or "").strip())
		for part in _formula_terms_for_alignment(
			line.get("formula") or "", panel_template, service_request
		):
			if part:
				_copy_to_label(part)


def _apply_result_overrides_to_values(
	values: dict[str, float], result_overrides: list[dict] | dict | None
) -> None:
	"""Overlay unsaved / on-screen sibling results so sum/formula checks match the UI.

	``result_overrides`` may be:
	- a list of ``{name?, template?, custom_result}``
	- a dict of lab-test name → result string
	"""
	if not result_overrides:
		return

	rows: list[dict] = []
	if isinstance(result_overrides, dict):
		for key, raw in result_overrides.items():
			rows.append({"name": str(key), "custom_result": raw})
	else:
		for row in result_overrides:
			if isinstance(row, dict):
				rows.append(row)

	for row in rows:
		val = _parse_float(row.get("custom_result"))
		if val is None:
			continue
		name = (row.get("name") or "").strip()
		tpl = (row.get("template") or "").strip()
		lab_name = (row.get("lab_test_name") or "").strip()
		if name and frappe.db.exists("Lab Test", name):
			meta = frappe.db.get_value(
				"Lab Test", name, ["template", "lab_test_name"], as_dict=True
			) or {}
			tpl = tpl or (meta.get("template") or "").strip()
			lab_name = lab_name or (meta.get("lab_test_name") or "").strip()
		for key in filter(None, [tpl, _display_name_for_template(tpl), lab_name, name]):
			values[key] = val


def _merge_panel_sibling_values(
	values: dict[str, float],
	panel_template: str,
	*,
	service_request: str | None = None,
	lab_test_group: str | None = None,
	patient: str | None = None,
	current_doc=None,
	result_overrides: list[dict] | dict | None = None,
) -> None:
	"""Load custom_result from each child lab test in the panel (for formulas and sums)."""
	if not panel_template:
		return
	values.update(
		collect_panel_result_values(
			panel_template,
			service_request=service_request,
			lab_test_group=lab_test_group,
			patient=patient,
			current_doc=current_doc,
		)
	)
	_apply_result_overrides_to_values(values, result_overrides)


def _persist_calculated_lab_test_result(lt_name: str, formatted: str) -> str | None:
	"""Save calculated result on a Lab Test document (reliable for Text Editor fields).

	Returns the status after save (so callers can refresh the UI).
	"""
	if not lt_name:
		return None
	text = str(formatted).strip() if formatted is not None else ""
	lt = frappe.get_doc("Lab Test", lt_name)
	old_result = (lt.custom_result or "").strip()
	cur_status = (lt.status or "").strip()
	lt.custom_result = text
	if lt.meta.has_field("results"):
		lt.results = text

	# Whenever a formula writes a result, move the sibling into Pending Review
	# (unless cancelled/rejected, or Reviewed with an unchanged result).
	# Covers Sample Collected, Partial Result Enter, Testing in Progress, etc.
	if text:
		if cur_status in ("Cancelled", "Rejected"):
			pass
		elif cur_status == "Reviewed" and text == old_result:
			pass
		else:
			lt.status = "Pending Review"

	lt.flags.skip_editing_lock = True
	if text:
		try:
			from healthcare.api.lab_test import _calculate_result_flag

			patient_gender = (
				frappe.db.get_value("Patient", lt.patient, "sex") if lt.patient else None
			)
			template_doc = frappe.get_doc("Lab Test Template", lt.template) if lt.template else None
			if template_doc:
				lt.result_flag = _calculate_result_flag(
					text,
					patient_gender,
					template_doc.get("female_min_range"),
					template_doc.get("female_max_range"),
					template_doc.get("male_min_range"),
					template_doc.get("male_max_range"),
					template_doc.get("min_range"),
					template_doc.get("max_range"),
				)
		except Exception:
			frappe.log_error(
				title="Lab result flag on calculated test",
				message=frappe.get_traceback(),
			)
	lt.flags.ignore_permissions = True
	if lt.docstatus == 1:
		lt.flags.ignore_validate_update_after_submit = True
	lt.save(ignore_permissions=True)
	# Belt-and-suspenders: force status in DB in case a hook reloads/overwrites it
	if text and (lt.status or "").strip() == "Pending Review":
		frappe.db.set_value(
			"Lab Test",
			lt.name,
			"status",
			"Pending Review",
			update_modified=False,
		)
	if text and (lt.docstatus == 0 or (cur_status == "Reviewed" and text != old_result)):
		try:
			from healthcare.api.lab_test_doctor_review import record_results_entered

			record_results_entered(lt.name)
		except Exception:
			pass
	return (lt.status or "").strip() or None


def _sync_calculated_targets_to_lab_tests(
	doc,
	rules: dict[str, Any],
	calculated: dict[str, str],
	*,
	service_request: str | None = None,
	lab_test_group: str | None = None,
	persist: bool = True,
) -> list[dict[str, str]]:
	"""Write formula/ratio results onto sibling Lab Test custom_result fields."""
	panel_template = (rules.get("lab_test_template") or "").strip()
	updates: list[dict[str, str]] = []
	if not panel_template or not calculated:
		return updates
	patient = getattr(doc, "patient", None)
	group_key = lab_test_group or panel_template
	for target_label, formatted in calculated.items():
		tpl = _template_for_event_label(target_label, panel_template)
		if not tpl:
			continue
		if _norm_key(tpl) == _norm_key(doc.template or ""):
			doc.custom_result = formatted
			status = None
			if persist and doc.name:
				status = _persist_calculated_lab_test_result(doc.name, formatted)
				if status:
					doc.status = status
			updates.append(
				{
					"name": doc.name,
					"lab_test_name": getattr(doc, "lab_test_name", None) or target_label,
					"custom_result": formatted,
					"status": status or "Pending Review",
				}
			)
			continue
		lt_name = _find_lab_test_for_panel_child(
			tpl,
			service_request=service_request,
			lab_test_group=group_key,
			patient=patient,
			panel_template=panel_template,
		)
		if lt_name and lt_name != doc.name:
			status = None
			if persist:
				status = _persist_calculated_lab_test_result(lt_name, formatted)
			updates.append(
				{
					"name": lt_name,
					"lab_test_name": frappe.db.get_value("Lab Test", lt_name, "lab_test_name")
					or target_label,
					"custom_result": formatted,
					"status": status or "Pending Review",
				}
			)
	return updates


def build_event_index(items) -> dict[str, Any]:
	"""Map normalized event name -> row (dict or Document)."""
	index: dict[str, Any] = {}
	for row in items or []:
		if isinstance(row, dict):
			keys = [
				row.get("lab_test_event"),
				row.get("lab_test_name"),
			]
		else:
			keys = [getattr(row, "lab_test_event", None), getattr(row, "lab_test_name", None)]
		for key in keys:
			if key and _norm_key(key) not in index:
				index[_norm_key(key)] = row
	return index


def get_numeric_values(items) -> dict[str, float]:
	"""Map canonical event label (first matching key) -> float."""
	values: dict[str, float] = {}
	for row in items or []:
		if isinstance(row, dict):
			label = (row.get("lab_test_event") or row.get("lab_test_name") or "").strip()
			raw = row.get("result_value")
		else:
			label = (getattr(row, "lab_test_event", None) or getattr(row, "lab_test_name", None) or "").strip()
			raw = getattr(row, "result_value", None)
		val = _parse_float(raw)
		if label and val is not None:
			values[label] = val
	return values


def resolve_event_value(event_name: str, index: dict[str, Any], values: dict[str, float]) -> float | None:
	if not event_name:
		return None
	key = _norm_key(event_name)
	for label, val in values.items():
		if _norm_key(label) == key:
			return val
	row = index.get(key)
	if not row:
		return None
	if isinstance(row, dict):
		return _parse_float(row.get("result_value"))
	return _parse_float(getattr(row, "result_value", None))


def _formula_name_boundary_pattern(name: str) -> str:
	"""Regex for a whole formula operand (supports dots/hyphens in test names).

	Slash may follow the name (e.g. ``S.creatinine/@Kappa``) — it is division, not part of the name.
	"""
	return r"(?<![\w./-])" + re.escape(name) + r"(?![\w.-])"


def _formula_name_flexible_pattern(name: str) -> str:
	"""Like boundary pattern but spaces may vary (including inside parentheses)."""
	parts = re.split(r"(\s+)", (name or "").strip())
	out: list[str] = []
	for part in parts:
		if not part:
			continue
		if part.isspace():
			out.append(r"\s*")
		else:
			# Allow optional spaces just inside parentheses: (FBS) vs (FBS )
			escaped = re.escape(part)
			escaped = escaped.replace(r"\(", r"\(\s*").replace(r"\)", r"\s*\)")
			out.append(escaped)
	return r"(?<![\w./-])" + "".join(out) + r"(?![\w.-])"


def _formula_name_variants(name: str) -> list[str]:
	raw = (name or "").strip()
	if not raw:
		return []
	variants = [raw]
	nospace = re.sub(r"\s+", "", raw)
	if nospace and nospace not in variants:
		variants.append(nospace)
	dotted = re.sub(r"\.(?=\S)", ". ", raw)
	if dotted and dotted not in variants:
		variants.append(dotted)
	return variants


def _formula_name_in_formula(name: str, formula: str) -> bool:
	if not name or not formula:
		return False
	for variant in _formula_name_variants(name):
		if re.search(_formula_name_boundary_pattern(variant), formula, re.IGNORECASE):
			return True
		if re.search(_formula_name_flexible_pattern(variant), formula, re.IGNORECASE):
			return True
	return False


def _formula_operator_split(formula: str) -> list[str]:
	"""Split a formula into operand labels using + - * / only.

	Do not split on parentheses — they are part of names like ``Insulin (Fasting)``.
	"""
	parts: list[str] = []
	normalized = normalize_formula_operators(formula or "")
	for part in re.split(r"[+\-*/]+", normalized):
		part = part.strip()
		if part:
			parts.append(part)
	return parts


def _is_numeric_formula_term(term: str) -> bool:
	try:
		float((term or "").replace(",", ""))
		return True
	except (TypeError, ValueError):
		return False


def _panel_formula_operand_candidates(
	panel_template: str, service_request: str | None = None
) -> list[str]:
	"""Known child test identifiers for a panel (longest names first)."""
	candidates: list[str] = []
	seen: set[str] = set()

	def _add_name(nm: str | None):
		key = _norm_key(nm)
		if nm and key not in seen:
			seen.add(key)
			candidates.append(nm)

	if service_request:
		for row in frappe.get_all(
			"Lab Test",
			filters={"service_request": service_request, "docstatus": ["!=", 2]},
			fields=["template", "lab_test_name"],
		):
			tpl = (row.get("template") or "").strip()
			if tpl:
				for nm in _event_names_from_rule_event(
					{"lab_test_event": tpl, "aliases": ""}
				):
					_add_name(nm)
			_add_name((row.get("lab_test_name") or "").strip())

	if not panel_template:
		return sorted(candidates, key=len, reverse=True)

	for child in get_group_child_templates(panel_template):
		for nm in _event_names_from_rule_event(
			{"lab_test_event": child["lab_test_event"], "aliases": ""}
		):
			_add_name(nm)
	# Rule may be attached to a child template — include its group siblings via lab_group.
	meta = frappe.db.get_value(
		"Lab Test Template",
		panel_template,
		["lab_group", "lab_test_name", "name"],
		as_dict=True,
	)
	if meta:
		group = (meta.lab_group or "").strip()
		if group and group != panel_template:
			for child in get_group_child_templates(group):
				for nm in _event_names_from_rule_event(
					{"lab_test_event": child["lab_test_event"], "aliases": ""}
				):
					_add_name(nm)
		for nm in (meta.name, meta.lab_test_name):
			_add_name(nm)
	return sorted(candidates, key=len, reverse=True)


def _formula_terms_for_alignment(
	formula: str, panel_template: str, service_request: str | None = None
) -> list[str]:
	"""Operand labels referenced in a formula (match whole test names, not ``-`` inside names)."""
	terms: list[str] = []
	seen: set[str] = set()
	formula_text = formula or ""

	for nm in _panel_formula_operand_candidates(panel_template, service_request):
		if _formula_name_in_formula(nm, formula_text):
			key = _norm_key(nm)
			if key not in seen:
				seen.add(key)
				terms.append(nm)

	# Fallback for rules not tied to a group panel (e.g. Globulin on a single template).
	if not terms:
		for part in _formula_operator_split(formula):
			if _is_numeric_formula_term(part):
				continue
			key = _norm_key(part)
			if key not in seen:
				seen.add(key)
				terms.append(part)
	return terms


def _missing_formula_operand_labels(
	formula: str, values: dict[str, float], panel_template: str = ""
) -> list[str]:
	"""Formula operands that still have no numeric value in ``values``."""
	by_norm = {_norm_key(k): k for k, v in values.items() if v is not None}
	by_loose = {_norm_key_loose(k): k for k, v in values.items() if v is not None}
	missing: list[str] = []
	for term in _formula_terms_for_alignment(formula, panel_template):
		if _norm_key(term) not in by_norm and _norm_key_loose(term) not in by_loose:
			missing.append(term)
	return missing


def _patient_age_years(patient: str | None) -> float | None:
	if not patient or not frappe.db.exists("Patient", patient):
		return None
	dob = frappe.db.get_value("Patient", patient, "dob")
	if not dob:
		return None
	try:
		from dateutil.relativedelta import relativedelta

		from frappe.utils import getdate

		years = relativedelta(getdate(), getdate(dob)).years
		return float(years)
	except Exception:
		return None


def _patient_formula_context(patient: str | None) -> dict[str, float]:
	"""Reserved formula variables derived from the patient record."""
	if not patient or not frappe.db.exists("Patient", patient):
		return {}
	sex_field = "sex" if frappe.db.has_column("Patient", "sex") else None
	if not sex_field and frappe.db.has_column("Patient", "gender"):
		sex_field = "gender"
	sex = (
		(frappe.db.get_value("Patient", patient, sex_field) or "").strip().lower()
		if sex_field
		else ""
	)
	is_female = sex in ("female", "f")
	ctx: dict[str, float] = {
		"@Kappa": 0.7 if is_female else 0.9,
		"@Alpha": -0.241 if is_female else -0.302,
	}
	age_years = _patient_age_years(patient)
	if age_years is not None:
		ctx["@Age"] = age_years
	return ctx


def _formula_has_unresolved_identifiers(text: str) -> bool:
	"""True when non-numeric identifiers remain besides allowed min/max calls."""
	scrubbed = re.sub(r"\bmin\b", "", text, flags=re.IGNORECASE)
	scrubbed = re.sub(r"\bmax\b", "", scrubbed, flags=re.IGNORECASE)
	return bool(re.search(r"[a-zA-Z_]", scrubbed))


def _substitute_patient_formula_tokens(text: str, patient_context: dict[str, float]) -> str | None:
	for token in _PATIENT_FORMULA_TOKENS:
		if token not in text:
			continue
		val = patient_context.get(token)
		if val is None:
			return None
		text = text.replace(token, f"({val})")
	return text


def substitute_formula(
	formula: str,
	values: dict[str, float],
	patient_context: dict[str, float] | None = None,
) -> str | None:
	"""Replace event names with numeric literals; return None if a name is missing."""
	text = normalize_formula_operators((formula or "").strip())
	if not text:
		return None
	if patient_context:
		text = _substitute_patient_formula_tokens(text, patient_context)
		if text is None:
			return None
	placeholders: dict[str, str] = {}
	for i, name in enumerate(sorted(values.keys(), key=len, reverse=True)):
		val = values.get(name)
		if val is None:
			continue
		matched = False
		for variant in _formula_name_variants(name):
			pattern = None
			if re.search(_formula_name_boundary_pattern(variant), text, re.IGNORECASE):
				pattern = _formula_name_boundary_pattern(variant)
			elif re.search(_formula_name_flexible_pattern(variant), text, re.IGNORECASE):
				pattern = _formula_name_flexible_pattern(variant)
			if not pattern:
				continue
			ph = f"#{i}#"
			text = re.sub(pattern, ph, text, flags=re.IGNORECASE)
			placeholders[ph] = f"({val})"
			matched = True
			break
		if not matched:
			continue
	for ph, literal in placeholders.items():
		text = text.replace(ph, literal)
	if _formula_has_unresolved_identifiers(text):
		return None
	return text


def evaluate_formula(
	formula: str,
	values: dict[str, float],
	patient_context: dict[str, float] | None = None,
) -> float | None:
	expr = substitute_formula(formula, values, patient_context=patient_context)
	if not expr:
		return None
	try:
		return _safe_eval_arithmetic(expr)
	except (ValueError, SyntaxError, ZeroDivisionError, TypeError, OverflowError):
		return None


def _rule_lookup_template_candidates(template: str) -> list[str]:
	"""Template names that may own a Lab Test Result Rule for this test."""
	if not template:
		return []
	seen: set[str] = set()
	ordered: list[str] = []

	def _add(value: str | None):
		v = (value or "").strip()
		if v and v not in seen:
			seen.add(v)
			ordered.append(v)

	_add(template)
	meta = frappe.db.get_value(
		"Lab Test Template",
		template,
		["name", "lab_test_code", "lab_test_name", "lab_group"],
		as_dict=True,
	)
	if meta:
		for field in (meta.name, meta.lab_test_code, meta.lab_test_name, meta.lab_group):
			_add(field)
		if meta.lab_group:
			group = frappe.db.get_value(
				"Lab Test Template",
				meta.lab_group,
				["name", "lab_test_code", "lab_test_name"],
				as_dict=True,
			)
			if group:
				for field in (group.name, group.lab_test_code, group.lab_test_name):
					_add(field)
	return ordered


def get_enabled_rule_doc(template: str):
	if not template:
		return None
	name = None
	for candidate in _rule_lookup_template_candidates(template):
		name = frappe.db.get_value(
			"Lab Test Result Rule",
			{"lab_test_template": candidate, "enabled": 1},
			"name",
		)
		if name:
			break
		display = _display_name_for_template(candidate)
		if display and display != candidate:
			name = frappe.db.get_value(
				"Lab Test Result Rule",
				{"lab_test_name": display, "enabled": 1},
				"name",
			)
			if name:
				break
			name = frappe.db.get_value(
				"Lab Test Result Rule",
				{"lab_test_template": display, "enabled": 1},
				"name",
			)
			if name:
				break
	if not name:
		return None
	return frappe.get_doc("Lab Test Result Rule", name)


def get_panel_template_name(template: str) -> str:
	"""Parent group template for a child test (LAB-003), else the template itself."""
	template = (template or "").strip()
	if not template:
		return ""
	group = frappe.db.get_value("Lab Test Template", template, "lab_group")
	return ((group or template) or "").strip()


def get_enabled_rule_docs_for_panel(template: str, service_request: str | None = None) -> list:
	"""All enabled result rules on a panel: the group plus every child template.

	Formulas are often stored on the calculated child (e.g. Indirect Bilirubin /
	LAB-003-003), not on the group or on the input tests (T.Bilirubin).
	"""
	panel = get_panel_template_name(template)
	if not panel and not template:
		return []
	candidates: list[str] = []
	seen_cand: set[str] = set()

	def _add_cand(value: str | None):
		v = (value or "").strip()
		if v and v not in seen_cand:
			seen_cand.add(v)
			candidates.append(v)

	_add_cand(panel)
	_add_cand(template)
	for child in get_group_child_templates(panel):
		_add_cand(child.get("lab_test_event"))
	if service_request:
		for row in frappe.get_all(
			"Lab Test",
			filters={"service_request": service_request, "docstatus": ["!=", 2]},
			fields=["template"],
		):
			_add_cand(row.template)
			child_group = frappe.db.get_value("Lab Test Template", row.template, "lab_group")
			_add_cand(child_group)
			if child_group:
				for child in get_group_child_templates(child_group):
					_add_cand(child.get("lab_test_event"))

	docs = []
	seen_rules: set[str] = set()

	def _add_rule_name(name: str | None):
		if not name or name in seen_rules:
			return
		seen_rules.add(name)
		docs.append(frappe.get_doc("Lab Test Result Rule", name))

	for cand in candidates:
		_add_rule_name(
			frappe.db.get_value(
				"Lab Test Result Rule",
				{"lab_test_template": cand, "enabled": 1},
				"name",
			)
		)
		# Also match rules saved under an alternate template id with the same
		# display name (e.g. rule on LAB-124-001 while request uses LAB-124).
		display = _display_name_for_template(cand)
		if display:
			for row in frappe.get_all(
				"Lab Test Result Rule",
				filters={"enabled": 1, "lab_test_name": display},
				fields=["name", "lab_test_template"],
				limit=20,
			):
				_add_rule_name(row.name)
			_add_rule_name(
				frappe.db.get_value(
					"Lab Test Result Rule",
					{"lab_test_template": display, "enabled": 1},
					"name",
				)
			)
	return docs


def merge_rule_docs(docs, *, panel_template: str = "") -> dict[str, Any] | None:
	"""Merge panel + child rules.

	Formulas from every doc are combined. Sum-to-target rows come only from the
	panel/group rule's ``sum_events`` child table — never from every group child
	and never by inventing rows from ``get_group_child_templates``.
	"""
	if not docs:
		return None

	panel = (panel_template or "").strip()
	merged: dict[str, Any] = {
		"name": docs[0].name,
		"lab_test_template": panel or docs[0].lab_test_template,
		"enabled": True,
		"sum_events": [],
		"sum_events_configured": False,
		"sum_target": 100,
		"sum_tolerance": 0.5,
		"sum_block_save": False,
		"rule_lines": [],
	}

	for doc in docs:
		part = rule_doc_to_dict(doc)
		merged["rule_lines"].extend(part.get("rule_lines") or [])
		tpl = (part.get("lab_test_template") or "").strip()
		# Only the panel rule owns the differential / sum-to-target list.
		if not part.get("sum_events"):
			continue
		if panel and tpl and tpl != panel:
			continue
		if merged["sum_events"]:
			continue
		merged["sum_events"] = list(part["sum_events"])
		merged["sum_events_configured"] = True
		merged["sum_target"] = part.get("sum_target", 100)
		merged["sum_tolerance"] = part.get("sum_tolerance", 0.5)
		merged["sum_block_save"] = bool(part.get("sum_block_save"))
		merged["name"] = part.get("name") or merged["name"]

	if panel:
		merged["lab_test_template"] = panel
	return merged


def rule_doc_to_dict(rule_doc) -> dict[str, Any]:
	sum_events = []
	for row in rule_doc.sum_events or []:
		sum_events.append(
			{
				"lab_test_event": row.lab_test_event,
				"aliases": row.aliases or "",
			}
		)
	lines = []
	for row in rule_doc.rule_lines or []:
		lines.append(
			{
				"rule_type": row.rule_type,
				"target_event": row.target_event,
				"formula": row.formula or "",
				"source_events": row.source_events or "",
				"numerator_event": row.numerator_event or "",
				"denominator_event": row.denominator_event or "",
				"readonly": bool(row.readonly),
			}
		)
	return {
		"name": rule_doc.name,
		"lab_test_template": rule_doc.lab_test_template,
		"enabled": bool(rule_doc.enabled),
		"sum_events": sum_events,
		"sum_events_configured": bool(sum_events),
		"sum_target": rule_doc.sum_target if rule_doc.sum_target is not None else 100,
		"sum_tolerance": rule_doc.sum_tolerance if rule_doc.sum_tolerance is not None else 0.5,
		"sum_block_save": bool(rule_doc.sum_block_save),
		"rule_lines": lines,
	}


def apply_rules(
	template: str,
	items: list[dict],
	*,
	rule_doc=None,
	block_on_error: bool = False,
	service_request: str | None = None,
	lab_test_group: str | None = None,
	patient: str | None = None,
	current_doc=None,
	defer_formula_warnings: bool = False,
	result_overrides: list[dict] | dict | None = None,
) -> dict[str, Any]:
	"""Apply configured rules to a list of normal_test_item dicts (mutates copies in returned items)."""
	out_items = [dict(row) for row in (items or [])]
	index = build_event_index(out_items)
	values = get_numeric_values(out_items)
	warnings: list[dict[str, Any]] = []
	errors: list[dict[str, Any]] = []
	readonly_events: set[str] = set()
	calculated_targets: dict[str, str] = {}

	if rule_doc is None:
		rule_doc = get_enabled_rule_doc(template)
	if not rule_doc:
		return {
			"items": out_items,
			"warnings": warnings,
			"errors": errors,
			"readonly_events": [],
			"calculated_targets": calculated_targets,
		}

	rules = rule_doc if isinstance(rule_doc, dict) else rule_doc_to_dict(rule_doc)
	panel_template = (rules.get("lab_test_template") or "").strip()

	if current_doc:
		_merge_lab_test_custom_result_into_values(current_doc, values)

	# Load all panel child results (same as CBC sum — needed for formulas too).
	_merge_panel_sibling_values(
		values,
		panel_template,
		service_request=service_request,
		lab_test_group=lab_test_group,
		patient=patient,
		current_doc=current_doc,
		result_overrides=result_overrides,
	)
	_align_values_to_rule_event_names(values, rules, service_request=service_request)
	patient_ctx = _patient_formula_context(patient)

	# Sum validation — ONLY rows listed on the rule's sum_events child table.
	# Never fall back to every child of the lab group.
	sum_event_defs = list(rules.get("sum_events") or [])
	if not sum_event_defs and not rules.get("rule_lines"):
		warnings.append(
			{
				"type": "sum_validation_config",
				"message": _(
					"Lab Test Result Rule for this panel has no child tests listed under "
					"“Tests That Must Sum to Target”. Add only the tests that should add "
					"up to {0} (for CBC: Neutrophils, Lymphocytes, Monocytes, Eosinophils, "
					"Basophils) — not every child in the group."
				).format(rules.get("sum_target") or 100),
				"ok": False,
				"block_save": False,
			}
		)
	if sum_event_defs:
		parts: list[float] = []
		labeled_parts: list[tuple[str, float]] = []
		labels: list[str] = []
		missing: list[str] = []
		seen_sum_keys: set[str] = set()
		for ev in sum_event_defs:
			names = _event_names_from_rule_event(ev)
			if not names:
				continue
			# Deduplicate if the same child was listed twice on the rule.
			primary = names[0]
			dedupe_key = _norm_key(primary)
			if dedupe_key in seen_sum_keys:
				continue
			seen_sum_keys.add(dedupe_key)

			label = _display_name_for_template(primary) or primary
			val = None
			for candidate in names:
				val = resolve_event_value(candidate, index, values)
				if val is not None:
					break
			if val is None:
				missing.append(label)
			else:
				parts.append(val)
				labels.append(label)
				labeled_parts.append((label, val))
		if missing and parts:
			warnings.append(
				{
					"type": "sum_validation_missing",
					"ok": False,
					"block_save": False,
				}
			)
		elif parts and not missing:
			total = sum(parts)
			target = float(rules.get("sum_target") or 100)
			tolerance = float(rules.get("sum_tolerance") or 0.5)
			diff = abs(total - target)
			msg = _format_sum_validation_user_message(
				labels, total, target, tolerance, parts=labeled_parts
			)
			short_msg = _format_sum_validation_short_message(labels, total, target, tolerance)
			entry = {
				"type": "sum_validation",
				"message": msg,
				"short_message": short_msg,
				"title": _("Differential count check"),
				"total": total,
				"target": target,
				"tolerance": tolerance,
				"included_tests": [{"label": lab, "value": val} for lab, val in labeled_parts],
				"ok": diff <= tolerance,
				"block_save": bool(rules.get("sum_block_save")),
			}
			if diff > tolerance:
				if entry["block_save"]:
					errors.append(entry)
				else:
					warnings.append(entry)

	# Formula and ratio lines — formulas first so ratios can use calculated values
	rule_lines = list(rules.get("rule_lines") or [])
	rule_lines.sort(
		key=lambda line: (
			0 if (line.get("rule_type") or "Formula") == "Formula" else 1,
			line.get("target_event") or "",
		)
	)
	for line in rule_lines:
		target = (line.get("target_event") or "").strip()
		if not target:
			continue
		result_val = None
		rule_type = line.get("rule_type") or "Formula"
		if rule_type == "Ratio":
			num = resolve_event_value(line.get("numerator_event") or "", index, values)
			den = resolve_event_value(line.get("denominator_event") or "", index, values)
			if num is not None and den not in (None, 0):
				result_val = num / den
		else:
			formula = line.get("formula") or ""
			result_val = evaluate_formula(formula, values, patient_context=patient_ctx)
			# Incomplete formulas stay silent until all operands are entered
			# (e.g. HDL saved before T.Cholesterol / Triglycerides for LDL).

		if result_val is None:
			continue

		formatted = _format_result(result_val)
		calculated_targets[target] = formatted
		values[target] = float(result_val)
		row = index.get(_norm_key(target))
		if row is None:
			out_items.append(
				{
					"lab_test_event": target,
					"lab_test_name": target,
					"result_value": formatted,
					"lab_test_uom": "",
					"normal_range": "",
					"lab_test_comment": "",
				}
			)
			index[_norm_key(target)] = out_items[-1]
		else:
			if isinstance(row, dict):
				row["result_value"] = formatted
			else:
				row.result_value = formatted

		if line.get("readonly"):
			readonly_events.add(target)

	# Rebuild readonly list after all calculations
	for line in rules.get("rule_lines") or []:
		if line.get("readonly") and line.get("target_event"):
			readonly_events.add(line["target_event"].strip())

	if block_on_error and errors:
		err = errors[0]
		frappe.throw(
			err.get("short_message") or err.get("message") or _("Lab result validation failed"),
			title=err.get("title") or _("Results not saved"),
			exc=frappe.ValidationError,
		)

	return {
		"items": out_items,
		"warnings": warnings,
		"errors": errors,
		"readonly_events": sorted(readonly_events),
		"calculated_targets": calculated_targets,
	}


def _resolve_panel_template_and_rule(doc):
	"""Panel (group) template + a rule doc for a child or parent lab test.

	The panel template stays the group (e.g. LAB-003) even when the formula
	is stored on a child such as Indirect Bilirubin.
	"""
	template = (getattr(doc, "template", None) or "").strip()
	if not template:
		return "", None
	panel_template = get_panel_template_name(template) or template
	docs = get_enabled_rule_docs_for_panel(template, getattr(doc, "service_request", None))
	return panel_template, (docs[0] if docs else None)


def apply_rules_to_doc(
	doc,
	*,
	block_on_error: bool = True,
	persist_siblings: bool = True,
	result_overrides: list[dict] | dict | None = None,
) -> dict[str, Any]:
	"""Apply rules for this lab test (compound rows and/or group child results)."""
	empty = {
		"warnings": [],
		"errors": [],
		"readonly_events": [],
		"calculated_targets": {},
		"calculated_updates": [],
	}
	if not doc.template:
		return empty

	panel_template, rule_doc = _resolve_panel_template_and_rule(doc)
	if not rule_doc:
		return empty

	items = []
	for row in doc.normal_test_items or []:
		items.append(
			{
				"lab_test_event": row.lab_test_event,
				"lab_test_name": row.lab_test_name,
				"result_value": row.result_value,
				"lab_test_uom": row.lab_test_uom,
				"normal_range": row.normal_range,
				"lab_test_comment": row.lab_test_comment,
				"template": row.template,
			}
		)

	rules_dict = merge_rule_docs(
		get_enabled_rule_docs_for_panel(doc.template, getattr(doc, "service_request", None)),
		panel_template=panel_template,
	) or rule_doc_to_dict(rule_doc)

	defer_formula_warnings = bool(
		getattr(doc, "service_request", None) and not persist_siblings
	)
	result = apply_rules(
		doc.template,
		items,
		rule_doc=rules_dict,
		block_on_error=block_on_error,
		service_request=getattr(doc, "service_request", None),
		lab_test_group=getattr(doc, "lab_test_group", None) or panel_template,
		patient=getattr(doc, "patient", None),
		current_doc=doc,
		defer_formula_warnings=defer_formula_warnings,
		result_overrides=result_overrides,
	)
	calculated_updates = _sync_calculated_targets_to_lab_tests(
		doc,
		rules_dict,
		result.get("calculated_targets") or {},
		service_request=getattr(doc, "service_request", None),
		lab_test_group=getattr(doc, "lab_test_group", None) or panel_template,
		persist=persist_siblings,
	)
	result["calculated_updates"] = calculated_updates
	result["calculated_targets"] = result.get("calculated_targets") or {}
	by_event = {
		_norm_key(r.get("lab_test_event") or r.get("lab_test_name")): r for r in result["items"]
	}
	for row in doc.normal_test_items or []:
		key = _norm_key(row.lab_test_event or row.lab_test_name)
		updated = by_event.get(key)
		if updated and updated.get("result_value") is not None:
			row.result_value = updated["result_value"]

	# Append any new calculated rows not already on the doc
	existing = {_norm_key(r.lab_test_event or r.lab_test_name) for r in doc.normal_test_items or []}
	for item in result["items"]:
		key = _norm_key(item.get("lab_test_event") or item.get("lab_test_name"))
		if key and key not in existing:
			doc.append(
				"normal_test_items",
				{
					"lab_test_name": item.get("lab_test_name") or item.get("lab_test_event"),
					"lab_test_event": item.get("lab_test_event") or item.get("lab_test_name"),
					"result_value": item.get("result_value") or "",
					"lab_test_uom": item.get("lab_test_uom") or "",
					"normal_range": item.get("normal_range") or "",
					"lab_test_comment": item.get("lab_test_comment") or "",
					"template": item.get("template") or doc.template,
					"require_result_value": 1,
				},
			)

	return result


def recalculate_panel_for_service_request(
	service_request: str, triggering_lab_test: str | None = None
) -> dict[str, Any]:
	"""Re-run all panel formulas/ratios for lab tests on one service request (after sibling saves)."""
	empty: dict[str, Any] = {"calculated_updates": [], "warnings": []}
	if not service_request:
		return empty

	lab_test_names = frappe.get_all(
		"Lab Test",
		filters={"service_request": service_request, "docstatus": ["!=", 2]},
		pluck="name",
	)
	if not lab_test_names:
		return empty

	triggering = None
	if triggering_lab_test and triggering_lab_test in lab_test_names:
		triggering = frappe.get_doc("Lab Test", triggering_lab_test)
	if not triggering:
		triggering = frappe.get_doc("Lab Test", lab_test_names[0])

	panel_template = get_panel_template_name(triggering.template) or (triggering.template or "")
	docs = get_enabled_rule_docs_for_panel(triggering.template, service_request)
	if not docs:
		return empty

	rules_dict = merge_rule_docs(docs, panel_template=panel_template)
	if not rules_dict:
		return empty

	result = apply_rules(
		triggering.template,
		[],
		rule_doc=rules_dict,
		service_request=service_request,
		lab_test_group=getattr(triggering, "lab_test_group", None) or panel_template,
		patient=triggering.patient,
		current_doc=triggering,
	)
	updates = _sync_calculated_targets_to_lab_tests(
		triggering,
		rules_dict,
		result.get("calculated_targets") or {},
		service_request=service_request,
		lab_test_group=getattr(triggering, "lab_test_group", None) or panel_template,
	)
	warnings = [
		w
		for w in (result.get("warnings") or [])
		if w.get("type") != "formula_missing_inputs"
	]
	return {
		"calculated_updates": updates,
		"warnings": warnings,
	}
