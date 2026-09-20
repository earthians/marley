

import frappe
from frappe import _
from frappe.utils import today, nowdate, getdate, flt, cint, nowtime
import json
from healthcare.api.common import (
    get_warehouse_for_cost_center,
    get_warehouses_for_cost_center as get_cc_warehouses,
    normalize_mini_warehouse_context,
    validate_warehouse_change_permission,
    _user_is_exempt
)


def _warehouse_for_cost_center(cost_center, warehouse_context=None):
    return get_warehouse_for_cost_center(
        cost_center,
        warehouse_context=normalize_mini_warehouse_context(warehouse_context),
    )


def _company_for_cost_center(cost_center, warehouse=None):
    """Resolve ERPNext company from the selected cost center."""
    if not cost_center:
        return None

    company = frappe.db.get_value("Cost Center", cost_center, "company")
    if company:
        return company

    if warehouse:
        company = frappe.db.get_value("Warehouse", warehouse, "company")
        if company:
            return company

    return frappe.defaults.get_global_default("company")


def _apply_mini_warehouse_metadata(doc, warehouse_context=None, notes=None):
    """Tag lab/nurse mini-warehouse documents and store optional notes."""
    ctx = normalize_mini_warehouse_context(warehouse_context)
    meta = frappe.get_meta(doc.doctype)

    if notes is not None and meta.has_field("custom_notes"):
        doc.custom_notes = notes

    if ctx == "laboratory" and meta.has_field("custom_lab_inventory"):
        doc.custom_lab_inventory = 1
    elif ctx == "nurse" and meta.has_field("custom_nurse_inventory"):
        doc.custom_nurse_inventory = 1


def _apply_stock_entry_branch(doc, cost_center):
    """Set Stock Entry header branch / cost center (portal branch = cost center)."""
    if not cost_center:
        return

    meta = frappe.get_meta(doc.doctype)
    if meta.has_field("cost_center"):
        doc.cost_center = cost_center

    for fieldname in ("branch", "custom_branch"):
        if not meta.has_field(fieldname):
            continue
        field = meta.get_field(fieldname)
        options = (field.options or "").strip() if field else ""
        if options == "Cost Center":
            doc.set(fieldname, cost_center)
        elif options == "Branch" and frappe.db.exists("Branch", cost_center):
            doc.set(fieldname, cost_center)


def _fallback_stock_entry_item_rate(item_code, uom=None, company=None):
    """Fallback basic rate from Item standard/selling price when warehouse valuation is missing."""
    from erpnext.stock.get_item_details import get_conversion_factor
    from healthcare.api.patient_medication_order import get_item_rate_for_uom

    rate = flt(get_item_rate_for_uom(item_code, uom))
    if rate > 0:
        return rate

    selling_pl = frappe.get_cached_value("Selling Settings", None, "selling_price_list")
    if not selling_pl and company:
        selling_pl = frappe.get_cached_value("Company", company, "default_selling_price_list")

    if selling_pl:
        filters = {"item_code": item_code, "price_list": selling_pl}
        item_price_meta = frappe.get_meta("Item Price")
        if item_price_meta.has_field("selling"):
            filters["selling"] = 1
        pl_rate = frappe.db.get_value("Item Price", filters, "price_list_rate")
        if pl_rate:
            rate = flt(pl_rate)
            uom = (uom or "").strip()
            stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
            if uom and stock_uom and uom != stock_uom:
                cf = flt(get_conversion_factor(item_code, uom).get("conversion_factor")) or 1
                rate *= cf
            return rate

    return 0


def _bind_stock_entry_rate_preserver(stock_entry):
    """Keep resolved basic rates through Stock Entry.validate (desk resets outgoing rates)."""
    import types

    from erpnext.stock.doctype.stock_entry.stock_entry import StockEntry

    if getattr(stock_entry, "_healthcare_rate_preserver_bound", False):
        return

    def calculate_rate_and_amount(self, reset_outgoing_rate=True, raise_error_if_no_rate=True):
        has_resolved_outgoing_rate = any(
            flt(row.basic_rate) > 0 for row in (self.items or []) if row.s_warehouse
        )
        if self.purpose in ("Material Transfer", "Material Issue") and has_resolved_outgoing_rate:
            reset_outgoing_rate = False
        return StockEntry.calculate_rate_and_amount(
            self, reset_outgoing_rate, raise_error_if_no_rate
        )

    stock_entry.calculate_rate_and_amount = types.MethodType(calculate_rate_and_amount, stock_entry)
    stock_entry._healthcare_rate_preserver_bound = True


def _item_has_batch_or_serial_tracking(item_code):
    flags = frappe.db.get_value(
        "Item", item_code, ["has_batch_no", "has_serial_no"], as_dict=True
    )
    if not flags:
        return False
    return bool(cint(flags.has_batch_no) or cint(flags.has_serial_no))


def _apply_stock_entry_serial_batch_fields(stock_entry):
    """Tick Use Batch/Serial fields on lines — avoid Serial and Batch Bundle documents."""
    for item in stock_entry.get("items") or []:
        if not _item_has_batch_or_serial_tracking(item.item_code):
            continue
        item.use_serial_batch_fields = 1
        item.serial_and_batch_bundle = None


def _stock_entry_row_serial_batch_fields(item_code, batch_no=None):
    """Row defaults for append() — use batch/serial columns when item is tracked."""
    if not _item_has_batch_or_serial_tracking(item_code):
        return {}
    fields = {"use_serial_batch_fields": 1}
    if batch_no:
        fields["batch_no"] = batch_no
    return fields


def _prepare_stock_entry_before_submit(stock_entry):
    """Resolve UOM, batch/serial mode, and basic rates the same way the Stock Entry desk form does."""
    from erpnext.stock.utils import get_incoming_rate

    if not stock_entry.get("posting_time"):
        stock_entry.posting_time = nowtime()

    stock_entry.validate_item()
    stock_entry.set_transfer_qty()
    _apply_stock_entry_serial_batch_fields(stock_entry)

    for item in stock_entry.get("items") or []:
        if not item.s_warehouse:
            continue

        args = stock_entry.get_args_for_incoming_rate(item)
        rate = flt(get_incoming_rate(args, raise_error_if_no_rate=False))
        if rate <= 0:
            rate = _fallback_stock_entry_item_rate(item.item_code, item.uom, stock_entry.company)
        if rate > 0:
            item.basic_rate = rate
            item.basic_amount = flt(item.transfer_qty) * flt(rate)

    # Keep resolved rates; do not overwrite with a second zero from stock ledger lookup.
    stock_entry.calculate_rate_and_amount(reset_outgoing_rate=False, raise_error_if_no_rate=True)


def _inventory_context_filters(doctype, warehouse_context=None):
    """Filter documents to the active mini-warehouse dashboard."""
    ctx = normalize_mini_warehouse_context(warehouse_context)
    meta = frappe.get_meta(doctype)

    if ctx == "laboratory" and meta.has_field("custom_lab_inventory"):
        return {"custom_lab_inventory": 1}
    if ctx == "nurse" and meta.has_field("custom_nurse_inventory"):
        return {"custom_nurse_inventory": 1}

    return {}


def _nursing_inventory_nhra_filter_enabled(warehouse_context=None):
    """Nurse inventory is not hard-limited to NHRA; use the Only NHRA UI filter instead."""
    return False


def _item_group_has_nhra_field():
    return frappe.get_meta("Item Group").has_field("custom_tracked_by_nhra")


def _item_group_chain_has_nhra_required(item_group_name, cache):
    """True if Item Group.custom_tracked_by_nhra is set on this group or any ancestor."""
    if not _item_group_has_nhra_field():
        return False
    if not item_group_name:
        return False
    if item_group_name in cache:
        return cache[item_group_name]
    row = frappe.db.get_value(
        "Item Group",
        item_group_name,
        ["custom_tracked_by_nhra", "parent_item_group"],
        as_dict=True,
    )
    if not row:
        cache[item_group_name] = False
        return False
    if row.get("custom_tracked_by_nhra"):
        cache[item_group_name] = True
        return True
    parent = (row.get("parent_item_group") or "").strip()
    result = _item_group_chain_has_nhra_required(parent, cache) if parent else False
    cache[item_group_name] = result
    return result


def _item_is_nhra_required(item_code, cache=None):
    if not item_code:
        return False
    if not _item_group_has_nhra_field():
        return False
    cache = cache if cache is not None else {}
    item_group = frappe.db.get_value("Item", item_code, "item_group")
    return _item_group_chain_has_nhra_required(item_group, cache)


def _nhra_required_item_group_names():
    """Item groups flagged custom_tracked_by_nhra plus all descendant groups."""
    if not _item_group_has_nhra_field():
        return None

    flagged = frappe.get_all(
        "Item Group",
        filters={"custom_tracked_by_nhra": 1},
        pluck="name",
    )
    if not flagged:
        return []

    groups = set(flagged)
    from frappe.utils.nestedset import get_descendants_of

    for group_name in flagged:
        try:
            groups.update(get_descendants_of("Item Group", group_name) or [])
        except Exception:
            pass
    return list(groups)


def _laboratory_allowed_item_group_names():
    """Item groups selected in Healthcare Settings.lab_item_group plus descendants.

    Returns:
        None: no lab item-group restriction configured
        []: configured but nothing resolves
        list[str]: allowed item groups
    """
    settings = frappe.get_cached_doc("Healthcare Settings")
    selected = [
        (row.item_group or "").strip()
        for row in (settings.get("lab_item_group") or [])
        if (row.item_group or "").strip()
    ]
    if not selected:
        return None

    groups = set(selected)
    from frappe.utils.nestedset import get_descendants_of

    for group_name in selected:
        try:
            groups.update(get_descendants_of("Item Group", group_name) or [])
        except Exception:
            pass
    return list(groups)


def _inventory_allowed_item_group_names(warehouse_context=None):
    ctx = normalize_mini_warehouse_context(warehouse_context)
    if ctx == "laboratory":
        return _laboratory_allowed_item_group_names()
    if _nursing_inventory_nhra_filter_enabled(ctx):
        return _nhra_required_item_group_names()
    return None


def _inventory_context_label(warehouse_context=None):
    return (
        _("laboratory inventory")
        if normalize_mini_warehouse_context(warehouse_context) == "laboratory"
        else _("nursing inventory")
    )


def _item_is_allowed_for_inventory_context(item_code, warehouse_context=None, cache=None):
    if not item_code:
        return False
    allowed_groups = _inventory_allowed_item_group_names(warehouse_context)
    if allowed_groups is None:
        return True
    cache = cache if cache is not None else {}
    if item_code not in cache:
        item_group = frappe.db.get_value("Item", item_code, "item_group")
        cache[item_code] = bool(item_group and item_group in set(allowed_groups))
    return cache[item_code]


def _assert_nhra_item_for_nursing_inventory(item_code, warehouse_context=None):
    allowed_groups = _inventory_allowed_item_group_names(warehouse_context)
    if allowed_groups is None:
        return
    if not _item_is_allowed_for_inventory_context(item_code, warehouse_context):
        frappe.throw(
            _("Item {0} is not allowed in {1}.").format(
                item_code
                , _inventory_context_label(warehouse_context)
            )
        )


def _filter_rows_by_nhra_item(rows, item_code_field="item_code", warehouse_context=None):
    allowed_groups = _inventory_allowed_item_group_names(warehouse_context)
    if allowed_groups is None:
        return rows
    cache = {}
    return [row for row in rows if _item_is_allowed_for_inventory_context(row.get(item_code_field), warehouse_context, cache)]


def inherit_mini_warehouse_flags_on_stock_entry(doc, method=None):
    """Copy mini-warehouse flags from a linked Material Request onto Stock Entry."""
    meta = frappe.get_meta("Stock Entry")
    if not meta.has_field("custom_lab_inventory") and not meta.has_field("custom_nurse_inventory"):
        return

    if doc.get("custom_lab_inventory") or doc.get("custom_nurse_inventory"):
        return

    mr_names = {
        row.material_request
        for row in (doc.get("items") or [])
        if row.get("material_request")
    }
    if not mr_names:
        return

    mr_meta = frappe.get_meta("Material Request")
    mr_fields = []
    for fieldname in ("custom_lab_inventory", "custom_nurse_inventory", "custom_notes"):
        if mr_meta.has_field(fieldname):
            mr_fields.append(fieldname)
    if not mr_fields:
        return

    for mr_name in mr_names:
        mr = frappe.db.get_value("Material Request", mr_name, mr_fields, as_dict=True)
        if not mr:
            continue

        if mr.get("custom_lab_inventory") and meta.has_field("custom_lab_inventory"):
            doc.custom_lab_inventory = 1
        if mr.get("custom_nurse_inventory") and meta.has_field("custom_nurse_inventory"):
            doc.custom_nurse_inventory = 1
        if mr.get("custom_notes") and meta.has_field("custom_notes") and not doc.get("custom_notes"):
            doc.custom_notes = mr.custom_notes
        return


@frappe.whitelist()
def get_stock_ledger(cost_center, warehouse_context=None):
    """
    Get stock ledger for a specific cost center using warehouse from Healthcare Settings.

    warehouse_context: 'nurse' (default) or 'laboratory'.

    Uses the Nurse/Lab **mini warehouse** mapped to the branch cost center
    (Healthcare Settings → Nurse Mini Warehouse / Laboratory Mini Warehouse) —
    not the branch pharmacy / prescription warehouse.

    Each row includes stock in stock UOM plus pack and unit quantities when those
    UOMs are configured on the Item UOM Conversion table (ERPNext conversion_factor).
    """
    if not cost_center:
        frappe.throw(_("Cost Center is required"))

    warehouse = _warehouse_for_cost_center(cost_center, warehouse_context)

    if not warehouse:
        return []

    allowed_groups = _inventory_allowed_item_group_names(warehouse_context)
    if allowed_groups is not None and not allowed_groups:
        return []

    # Prefer Bin.actual_qty — same balance ERPNext Stock Balance / Item stock UI use.
    # SUM(SLE) without is_cancelled=0 can diverge and show wrong (often negative) qty.
    sql = """
        SELECT
            b.item_code,
            i.item_name,
            i.item_group as category,
            b.actual_qty as current_stock,
            i.stock_uom as uom,
            i.valuation_rate as unit_price,
            b.modified as last_updated
        FROM `tabBin` b
        INNER JOIN `tabItem` i ON i.name = b.item_code
        WHERE b.warehouse = %s
          AND IFNULL(b.actual_qty, 0) != 0
    """
    params = [warehouse]
    if allowed_groups is not None:
        placeholders = ", ".join(["%s"] * len(allowed_groups))
        sql += f" AND i.item_group IN ({placeholders})"
        params.extend(allowed_groups)
    sql += """
        ORDER BY i.item_name
    """
    stock_items = frappe.db.sql(sql, tuple(params), as_dict=1)

    # Get reorder levels from Item Reorder table
    reorder_map = {}
    if frappe.db.exists("DocType", "Item Reorder"):
        reorders = frappe.get_all(
            "Item Reorder",
            filters={"parenttype": "Item"},
            fields=["parent as item_code", "warehouse", "warehouse_reorder_level"],
            as_list=False,
        )
        for r in reorders:
            level = flt(r.get("warehouse_reorder_level")) or 0
            if level > 0:
                reorder_map[r.get("item_code")] = level

    for item in stock_items:
        item["reorder_level"] = reorder_map.get(item["item_code"], 10)
        item["item_group"] = item.get("category")
        item["warehouse"] = warehouse

    nhra_cache = {}
    for item in stock_items:
        item["tracked_by_nhra"] = 1 if _item_is_nhra_required(item.get("item_code"), nhra_cache) else 0

    _enrich_stock_ledger_pack_unit_qty(stock_items)

    return stock_items


@frappe.whitelist()
def get_stock_ledger_export(cost_center, warehouse_context=None):
	"""Stock ledger rows for PDF/Excel — item totals in units (no dispensing-lot breakdown)."""
	if not cost_center:
		frappe.throw(_("Cost Center is required"))

	warehouse = _warehouse_for_cost_center(cost_center, warehouse_context)
	if not warehouse:
		return {"warehouse": "", "rows": []}

	stock_items = get_stock_ledger(cost_center, warehouse_context) or []
	rows: list[dict] = []

	for item in stock_items:
		item_code = (item.get("item_code") or "").strip()
		if not item_code:
			continue

		unit_qty = item.get("unit_qty")
		pack_qty = item.get("pack_qty")
		# Prefer unit (dispense) qty; fall back to stock UOM qty.
		qty = unit_qty if unit_qty is not None else item.get("current_stock")
		uom = (item.get("unit_uom") or item.get("uom") or "").strip()

		rows.append(
			{
				"item_code": item_code,
				"item_name": item.get("item_name") or item_code,
				"item_group": item.get("item_group") or item.get("category") or "",
				"qty": flt(qty),
				"uom": uom,
				"pack_qty": pack_qty,
				"pack_uom": item.get("pack_uom") or "",
				"unit_qty": unit_qty,
				"unit_uom": item.get("unit_uom") or "",
				"stock_qty": item.get("current_stock"),
				"stock_uom": item.get("uom") or "",
				"reorder_level": item.get("reorder_level"),
				"unit_price": item.get("unit_price"),
				"warehouse": warehouse,
			}
		)

	return {"warehouse": warehouse, "rows": rows}


@frappe.whitelist()
def get_inventory_dashboard_warehouse(cost_center, warehouse_context=None):
    """Warehouse used by Inventory Dashboard Stock Ledger for the branch."""
    if not cost_center:
        frappe.throw(_("Cost Center is required"))
    return _warehouse_for_cost_center(cost_center, warehouse_context)


def _normalize_uom_key(value):
    return (value or "").strip().upper()


def _is_pack_uom(uom):
    key = _normalize_uom_key(uom)
    return key in ("PACK", "PACKS") or key.startswith("PACK")


def _is_unit_uom(uom):
    key = _normalize_uom_key(uom)
    return key in ("UNIT", "UNITS", "NOS", "EA", "EACH") or key.startswith("UNIT")


def _qty_in_uom(qty_stock_uom, stock_uom, target_uom, conversion_factor):
    """Convert qty expressed in stock_uom into target_uom using ERPNext conversion_factor."""
    qty = flt(qty_stock_uom)
    if not target_uom:
        return None
    if _normalize_uom_key(target_uom) == _normalize_uom_key(stock_uom):
        return qty
    cf = flt(conversion_factor) or 0
    if cf <= 0:
        return None
    # 1 target_uom = cf stock_uom
    return qty / cf


def _enrich_stock_ledger_pack_unit_qty(stock_items):
    """Attach pack_qty / unit_qty from Item UOM Conversion Detail only (no units-per-pack field)."""
    if not stock_items:
        return

    item_codes = [row.get("item_code") for row in stock_items if row.get("item_code")]
    if not item_codes:
        return

    # UOM conversion rows: conversion_factor = stock_uom qty per 1 of this uom
    uom_rows_by_item = {}
    if frappe.db.exists("DocType", "UOM Conversion Detail"):
        for row in frappe.get_all(
            "UOM Conversion Detail",
            filters={"parent": ["in", item_codes]},
            fields=["parent", "uom", "conversion_factor"],
        ):
            uom_rows_by_item.setdefault(row.parent, []).append(row)

    for item in stock_items:
        code = item.get("item_code")
        stock_uom = item.get("uom") or ""
        qty = flt(item.get("current_stock"))
        conversions = uom_rows_by_item.get(code) or []

        pack_uom = None
        pack_cf = None
        unit_uom = None
        unit_cf = None

        for row in conversions:
            uom = row.get("uom")
            cf = flt(row.get("conversion_factor")) or 0
            if not uom or cf <= 0:
                continue
            if _is_pack_uom(uom) and pack_uom is None:
                pack_uom = uom
                pack_cf = cf
            elif _is_unit_uom(uom) and unit_uom is None:
                unit_uom = uom
                unit_cf = cf

        # Stock UOM itself may already be Pack or Unit
        if _is_pack_uom(stock_uom) and not pack_uom:
            pack_uom = stock_uom
            pack_cf = 1.0
        if _is_unit_uom(stock_uom) and not unit_uom:
            unit_uom = stock_uom
            unit_cf = 1.0

        pack_qty = _qty_in_uom(qty, stock_uom, pack_uom, pack_cf) if pack_uom else None
        unit_qty = _qty_in_uom(qty, stock_uom, unit_uom, unit_cf) if unit_uom else None

        item["pack_qty"] = round(flt(pack_qty), 6) if pack_qty is not None else None
        item["pack_uom"] = pack_uom
        item["unit_qty"] = round(flt(unit_qty), 6) if unit_qty is not None else None
        item["unit_uom"] = unit_uom
        item["units_per_pack"] = None


@frappe.whitelist()
def get_warehouses_for_cost_center(cost_center, warehouse_context=None):
    """Get warehouses linked to a cost center from Healthcare Settings mini-warehouse tables."""
    if not cost_center:
        frappe.throw(_("Cost Center is required"))

    ctx = normalize_mini_warehouse_context(warehouse_context)
    warehouses = get_cc_warehouses(cost_center, warehouse_context=ctx)

    if not warehouses:
        default_wh = get_warehouse_for_cost_center(cost_center, warehouse_context=ctx)
        if default_wh:
            warehouses = [{"name": default_wh, "label": default_wh}]

    if not warehouses:
        company = _company_for_cost_center(cost_center)
        if company:
            rows = frappe.get_all(
                "Warehouse",
                filters={"company": company, "is_group": 0, "disabled": 0},
                fields=["name", "warehouse_name"],
                order_by="warehouse_name asc",
                limit=100,
            )
            warehouses = [
                {"name": row.name, "label": row.warehouse_name or row.name}
                for row in rows
            ]

    if not warehouses:
        label = (
            _("Laboratory Mini Warehouse")
            if ctx == "laboratory"
            else _("Nurse Mini Warehouse")
        )
        frappe.msgprint(
            _("No warehouses configured for cost center {0} in Healthcare Settings ({1})").format(
                cost_center, label
            )
        )
        return []

    return warehouses


@frappe.whitelist()
def get_suppliers(search=None):
    """Suppliers for material receipt dropdown/search."""
    if not frappe.db.exists("DocType", "Supplier"):
        return []

    filters = {"disabled": 0}
    or_filters = None
    search = (search or "").strip()
    if search:
        or_filters = {
            "supplier_name": ["like", f"%{search}%"],
            "name": ["like", f"%{search}%"],
        }

    rows = frappe.get_all(
        "Supplier",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "supplier_name"],
        order_by="supplier_name asc",
        limit=50 if search else 100,
    )
    return [{"name": row.name, "label": row.supplier_name or row.name} for row in rows]

@frappe.whitelist()
def get_inventory_items(search=None, warehouse_context=None):
    """
    Get inventory items for dropdown/search.

    Laboratory mini-warehouse inventory limits items to Healthcare Settings.lab_item_group
    when any lab groups are configured there.
    """
    filters = {"disabled": 0, "item_group": ["is", "set"]}
    fields = ["item_code as code", "item_name as name", "stock_uom as uom", "valuation_rate as price", "item_group"]

    allowed_groups = _inventory_allowed_item_group_names(warehouse_context)
    if allowed_groups is not None and not allowed_groups:
        return []
    if allowed_groups is not None:
        filters["item_group"] = ["in", allowed_groups]

    if search:
        filters["item_code"] = ["like", f"%{search}%"]

    items = frappe.get_all("Item", filters=filters, fields=fields, limit=50)

    # If no results by item_code, try by item_name
    if search and len(items) == 0:
        name_filters = {"disabled": 0, "item_name": ["like", f"%{search}%"], "item_group": ["is", "set"]}
        if allowed_groups is not None:
            name_filters["item_group"] = ["in", allowed_groups]
        items = frappe.get_all("Item", filters=name_filters, fields=fields, limit=50)

    for item in items:
        item.pop("item_group", None)

    return items


@frappe.whitelist()
def get_item_uom_options(item_code):
    """Return selectable UOMs for an item (stock, sales, and conversion UOMs)."""
    if not item_code:
        return []

    item = frappe.get_cached_doc("Item", item_code)
    seen = []
    for uom in (item.stock_uom, item.sales_uom):
        if uom and uom not in seen:
            seen.append(uom)
    for row in item.get("uoms") or []:
        if row.uom and row.uom not in seen:
            seen.append(row.uom)

    return [{"name": uom, "label": uom} for uom in seen]


@frappe.whitelist()
def get_item_groups(search=None, warehouse_context=None):
    """
    Get item groups for dropdown selection.
    Returns only leaf item groups (not parent groups).

    Laboratory mini-warehouse inventory limits groups to Healthcare Settings.lab_item_group
    when any lab groups are configured there.
    """
    filters = {"is_group": 0}

    allowed_groups = _inventory_allowed_item_group_names(warehouse_context)
    if allowed_groups is not None and not allowed_groups:
        return []
    if allowed_groups is not None:
        filters["name"] = ["in", allowed_groups]

    if search:
        filters["item_group_name"] = ["like", f"%{search}%"]

    item_groups = frappe.get_all(
        "Item Group",
        filters=filters,
        fields=["name", "item_group_name as label"],
        order_by="item_group_name",
        limit=100,
    )

    return item_groups

@frappe.whitelist()
def get_default_warehouse_and_cost_center(cost_center=None):
    """
    Get warehouse / company / care-type metadata for a cost center.

    Portal branch is UI-selected (localStorage). Pass ``cost_center`` from the portal
    branch picker. When omitted, falls back to Employee.cost_center only (no User Permission).
    """
    user = frappe.session.user
    
    try:
        requested = (cost_center or "").strip() or None
        resolved = requested
        if not resolved:
            employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
            if employee:
                resolved = frappe.db.get_value("Employee", employee, "cost_center")
        
        warehouse = None
        if resolved:
            warehouse = _warehouse_for_cost_center(resolved)

        can_change = _user_is_exempt(user)

        patient_care_type = ""
        company_from_cc = ""
        if resolved:
            try:
                cc_meta = frappe.get_meta("Cost Center")
                cc_fields = ["company"]
                if cc_meta.has_field("custom_patient_care_type"):
                    cc_fields.append("custom_patient_care_type")
                rows = frappe.get_all(
                    "Cost Center",
                    filters={"name": resolved},
                    fields=cc_fields,
                    limit=1,
                    ignore_permissions=True,
                )
                r0 = rows[0] if rows else {}
                if cc_meta.has_field("custom_patient_care_type"):
                    patient_care_type = ((r0.get("custom_patient_care_type") or "") or "").strip()
                company_from_cc = ((r0.get("company") or "") or "").strip()
            except Exception:
                patient_care_type = ""
                company_from_cc = ""
        return {
            "warehouse": warehouse or "",
            "cost_center": resolved or "",
            "can_change_warehouse": can_change,
            "cost_center_patient_care_type": patient_care_type,
            "company": company_from_cc or "",
        }
    except Exception as e:
        frappe.log_error(f"Error getting default warehouse and cost center: {str(e)}")
        return {
            "warehouse": "",
            "cost_center": "",
            "can_change_warehouse": False,
            "cost_center_patient_care_type": "",
            "company": "",
        }


@frappe.whitelist()
def create_material_request():
    """
    Create a Material Request document.

    The Material Request purpose is always **Purchase** — nurse/lab mini-warehouse
    requests are procurement indents raised against stores.

    Warehouse is automatically set from Healthcare Settings based on cost_center.
    Only Administrators and System Managers can override the warehouse.
    
    Expects POST data with the following structure:
    {
        "cost_center": "Cost Center Name",
        "warehouse": "Warehouse Name (optional - only for admin/system manager)",
        "request_date": "2024-01-01",
        "items": [
            {
                "item_code": "ITEM001",
                "item_name": "Item Name",
                "quantity": 10,
                "uom": "Unit",
                "notes": "Optional notes"
            }
        ],
        "requested_by": "User Name",
        "notes": "General notes"
    }
    """
    try:
        data = frappe.local.form_dict
        if not data:
            data = json.loads(frappe.request.data)
        
        cost_center = data.get("cost_center")
        user_provided_warehouse = data.get("warehouse")
        
        if not cost_center:
            frappe.throw(_("Cost Center is required"))
        
        # Get warehouse from Healthcare Settings
        warehouse = _warehouse_for_cost_center(cost_center, data.get("warehouse_context"))
        
        # If user is trying to override warehouse, validate permission
        if user_provided_warehouse and user_provided_warehouse != warehouse:
            validate_warehouse_change_permission()
            warehouse = user_provided_warehouse
        
        if not warehouse:
            frappe.throw(_("No warehouse found for cost center {0} in Healthcare Settings").format(cost_center))

        company = _company_for_cost_center(cost_center, warehouse)
        if not company:
            frappe.throw(
                _("Company could not be resolved for cost center {0}. Set Company on the Cost Center in ERPNext.").format(
                    cost_center
                )
            )

        schedule_date = data.get("request_date", today())

        mr = frappe.new_doc("Material Request")
        # Nursing / lab mini-warehouse requests are procurement indents:
        # the purpose is always Purchase (never Material Transfer/Issue).
        mr.material_request_type = "Purchase"
        mr.transaction_date = schedule_date
        mr.schedule_date = schedule_date
        mr.company = company
        mr.cost_center = cost_center
        mr.set_warehouse = warehouse
        _apply_mini_warehouse_metadata(mr, data.get("warehouse_context"), data.get("notes"))

        is_medical = data.get("is_medical")
        if is_medical is None or str(is_medical).strip() == "":
            frappe.throw(_("Please choose whether this is a Medical or Consumable material request."))
        if mr.meta.has_field("custom_is_medical"):
            mr.custom_is_medical = 1 if cint(is_medical) else 0

        for item in data.get("items", []):
            item_code = (item.get("item_code") or "").strip()
            qty = flt(item.get("quantity"))
            if not item_code or qty <= 0:
                continue

            item_details = frappe.db.get_value(
                "Item",
                item_code,
                ["item_name", "stock_uom", "item_group"],
                as_dict=True,
            )
            if not item_details:
                frappe.throw(_("Item {0} not found").format(item_code))
            if not item_details.item_group:
                frappe.throw(
                    _("Item {0} has no Item Group. Set Item Group on the item before creating a material request.").format(
                        item_code
                    )
                )
            _assert_nhra_item_for_nursing_inventory(item_code, data.get("warehouse_context"))

            mr.append(
                "items",
                {
                    "item_code": item_code,
                    "qty": qty,
                    "uom": item.get("uom") or item_details.stock_uom,
                    "warehouse": warehouse,
                    "schedule_date": schedule_date,
                    "cost_center": cost_center,
                    "description": item.get("notes", ""),
                },
            )

        if not mr.items:
            frappe.throw(_("At least one item is required"))

        # Leave as Draft — stores/purchasing submit after review.
        mr.insert()
        frappe.db.commit()

        return {"name": mr.name, "status": mr.status}
        
    except Exception as e:
        frappe.throw(str(e))
        frappe.log_error(f"Error creating material request: {str(e)}")

@frappe.whitelist()
def get_material_requests(cost_center, status=None, warehouse_context=None):
    """Get material requests for a cost center and mini-warehouse dashboard.

    ``cost_center`` lives on Material Request Item (child), not always on the parent.
    Filtering the parent by that field joins children and can return the same MR once
    per item — so we resolve distinct parent names first.
    """
    if not cost_center:
        frappe.throw(_("Cost Center is required"))

    ctx_filters = _inventory_context_filters("Material Request", warehouse_context)

    # Distinct parents that have at least one item for this cost center.
    item_filters = {"cost_center": cost_center, "docstatus": ["<", 2]}
    parent_names = frappe.get_all(
        "Material Request Item",
        filters=item_filters,
        pluck="parent",
        distinct=True,
    )
    # Also include parents that store cost_center on the header (if the field exists).
    mr_meta = frappe.get_meta("Material Request")
    if mr_meta.has_field("cost_center"):
        header_names = frappe.get_all(
            "Material Request",
            filters={"cost_center": cost_center, **ctx_filters},
            pluck="name",
        )
        parent_names = list({*(parent_names or []), *(header_names or [])})

    if not parent_names:
        return []

    filters = {"name": ["in", parent_names], **ctx_filters}
    if status:
        filters["status"] = status

    fields = [
        "name",
        "transaction_date as request_date",
        "status",
        "custom_notes as notes",
        "material_request_type",
        "per_ordered",
        "per_received",
        "docstatus",
    ]
    if mr_meta.has_field("custom_is_medical"):
        fields.append("custom_is_medical as is_medical")
    if mr_meta.has_field("workflow_state"):
        fields.append("workflow_state")

    requests = frappe.get_all(
        "Material Request",
        filters=filters,
        fields=fields,
        order_by="creation desc",
    )

    # Safety: never return the same MR twice.
    seen = set()
    unique_requests = []
    for req in requests:
        name = req.get("name")
        if not name or name in seen:
            continue
        seen.add(name)
        unique_requests.append(req)
    requests = unique_requests

    for req in requests:
        req["items"] = _filter_rows_by_nhra_item(
            frappe.get_all(
                "Material Request Item",
                filters={"parent": req["name"]},
                fields=["item_code", "item_name", "qty as quantity", "uom", "description as notes"],
            ),
            warehouse_context=warehouse_context,
        )
        req["requested_by"] = frappe.db.get_value("Material Request", req["name"], "owner")
        if "is_medical" in req:
            req["is_medical"] = 1 if cint(req.get("is_medical")) else 0
        # Normalize for portal UI (approval vs supply/fulfillment).
        req["workflow_state"] = (req.get("workflow_state") or "").strip() or None

    return requests

# @frappe.whitelist()
# def create_stock_reconciliation():
#     """
#     Create standard ERPNext Stock Reconciliation document.
    
#     Warehouse is automatically set from Healthcare Settings based on cost_center.
#     Only Administrators and System Managers can override the warehouse.
    
#     Expects POST data:
#     {
#         "cost_center": "Cost Center Name",
#         "warehouse": "Warehouse Name (optional - only for admin/system manager)",
#         "reconciliation_date": "2024-01-01",
#         "items": [
#             {
#                 "item_code": "ITEM001",
#                 "qty": 15,
#                 "current_qty": 10
#             }
#         ],
#         "reconciled_by": "User Name"
#     }
#     """
#     try:
#         data = frappe.local.form_dict
#         if not data:
#             data = json.loads(frappe.request.data)
        
#         # Debug log
#         frappe.logger().info(f"Stock Reconciliation Request Data: {json.dumps(data)}")
        
#         cost_center = data.get("cost_center")
#         user_provided_warehouse = data.get("warehouse")
        
#         if not cost_center:
#             frappe.throw(_("Cost Center is required"))
        
#         # Get warehouse from Healthcare Settings
#         warehouse = _warehouse_for_cost_center(cost_center, data.get("warehouse_context"))
        
#         # If user is trying to override warehouse, validate permission
#         if user_provided_warehouse and user_provided_warehouse != warehouse:
#             validate_warehouse_change_permission()
#             warehouse = user_provided_warehouse
        
#         if not warehouse:
#             frappe.throw(_("No warehouse found for cost center {0} in Healthcare Settings").format(cost_center))
        
#         # Get expense account for the company
#         company = frappe.db.get_value("Warehouse", warehouse, "company")
#         expense_account = frappe.db.get_value("Company", company, "default_expense_account")
        
#         if not expense_account:
#             expense_account = "Stock Adjustment - W"  # Default fallback
        
#         # Create Stock Reconciliation
#         sr = frappe.get_doc({
#             "doctype": "Stock Reconciliation",
#             "purpose": "Stock Reconciliation",
#             "posting_date": data.get("reconciliation_date", today()),
#             "cost_center": cost_center,
#             "expense_account": expense_account,
#             "items": []
#         })
        
#         # Add items with adjustments
#         frappe.logger().info(f"Processing {len(data.get('items', []))} items for reconciliation")
        
#         for idx, item in enumerate(data.get("items", [])):
#             item_code = item.get("item_code")
            
#             # Get quantity values - handle field name variations from frontend
#             # Frontend sends: physical_quantity, physical_qty, qty, new_qty
#             physical_qty = (
#                 item.get("physical_quantity") or 
#                 item.get("physical_qty") or 
#                 item.get("qty") or 
#                 item.get("new_qty") or
#                 None
#             )
            
#             # Get system quantity - handle field name variations from frontend  
#             # Frontend sends: system_quantity, system_qty, current_qty, old_qty
#             system_qty = (
#                 item.get("system_quantity") or
#                 item.get("system_qty") or
#                 item.get("current_qty") or
#                 item.get("old_qty") or
#                 0
#             )
            
#             frappe.logger().info(
#                 f"Item {idx}: code={item_code}, physical_qty={physical_qty}, "
#                 f"system_qty={system_qty}, difference={physical_qty - system_qty if physical_qty is not None else 'N/A'}"
#             )
            
#             # Only add if there's a difference and item_code is provided
#             if item_code and physical_qty is not None and physical_qty != system_qty:
#                 frappe.logger().info(f"Adding item {item_code} with difference: {physical_qty - system_qty}")
#                 item_data = {
#                     "item_code": item_code,
#                     "warehouse": warehouse,
#                     "qty": physical_qty,
#                     "current_qty": system_qty,
#                 }
#                 if item.get("serial_no"):
#                     item_data["serial_no"] = item.get("serial_no")
#                 if item.get("batch_no"):
#                     item_data["batch_no"] = item.get("batch_no")
#                 sr.append("items", item_data)
        
#         frappe.logger().info(f"Stock Reconciliation has {len(sr.items)} items with differences")
        
#         if not sr.items:
#             frappe.logger().warn("No items with differences found")
#             frappe.throw(_("No items with quantity differences found"))
        
#         sr.insert()
#         sr.submit()
#         frappe.db.commit()
        
#         frappe.response["message"] = {"name": sr.name}
#         frappe.response["http_status_code"] = 200
        
#     except Exception as e:
#         frappe.response["message"] = str(e)
#         frappe.response["http_status_code"] = 400
#         frappe.log_error(f"Error creating stock reconciliation: {str(e)}")


@frappe.whitelist()
def create_stock_reconciliation():
    """
    Create standard ERPNext Stock Reconciliation document.
    
    Handles serialized and batched items properly.
    """
    try:
        data = frappe.local.form_dict
        if not data:
            data = json.loads(frappe.request.data)
        
        # Debug log
        frappe.logger().info(f"Stock Reconciliation Request Data: {json.dumps(data)}")
        
        cost_center = data.get("cost_center")
        user_provided_warehouse = data.get("warehouse")
        
        if not cost_center:
            frappe.throw(_("Cost Center is required"))
        
        # Get warehouse from Healthcare Settings
        warehouse = _warehouse_for_cost_center(cost_center, data.get("warehouse_context"))
        
        # If user is trying to override warehouse, validate permission
        if user_provided_warehouse and user_provided_warehouse != warehouse:
            validate_warehouse_change_permission()
            warehouse = user_provided_warehouse
        
        if not warehouse:
            frappe.throw(_("No warehouse found for cost center {0} in Healthcare Settings").format(cost_center))
        
        company = _company_for_cost_center(cost_center, warehouse)
        if not company:
            frappe.throw(
                _("Company could not be resolved for cost center {0}. Set Company on the Cost Center in ERPNext.").format(
                    cost_center
                )
            )

        # Get expense account for the company
        expense_account = frappe.db.get_value("Company", company, "default_expense_account")
        
        if not expense_account:
            expense_account = "Stock Adjustment - W"  # Default fallback
        
        sr = frappe.new_doc("Stock Reconciliation")
        sr.purpose = "Stock Reconciliation"
        sr.posting_date = data.get("reconciliation_date", today())
        sr.cost_center = cost_center
        sr.expense_account = expense_account
        _apply_mini_warehouse_metadata(
            sr,
            data.get("warehouse_context"),
            data.get("notes") or data.get("custom_notes"),
        )
        
        frappe.logger().info(f"Processing {len(data.get('items', []))} items for reconciliation")
        
        for idx, item in enumerate(data.get("items", [])):
            item_code = item.get("item_code")
            
            # Get quantity values
            physical_qty = (
                item.get("physical_quantity") or 
                item.get("physical_qty") or 
                item.get("qty") or 
                item.get("new_qty") or
                None
            )
            
            system_qty = (
                item.get("system_quantity") or
                item.get("system_qty") or
                item.get("current_qty") or
                item.get("old_qty") or
                0
            )
            
            frappe.logger().info(
                f"Item {idx}: code={item_code}, physical_qty={physical_qty}, "
                f"system_qty={system_qty}, difference={physical_qty - system_qty if physical_qty is not None else 'N/A'}"
            )
            
            # Only add if there's a difference and item_code is provided
            if item_code and physical_qty is not None and physical_qty != system_qty:
                _assert_nhra_item_for_nursing_inventory(item_code, data.get("warehouse_context"))
                frappe.logger().info(f"Adding item {item_code} with difference: {physical_qty - system_qty}")
                
                # Get item details to check if it's serialized or batched
                item_details = frappe.get_cached_value("Item", item_code, 
                    ["has_serial_no", "has_batch_no", "stock_uom"], as_dict=1)
                
                item_data = {
                    "item_code": item_code,
                    "warehouse": warehouse,
                    "qty": physical_qty,
                    "current_qty": system_qty,
                    "current_qty_as_per_serial_no": system_qty,  # Important for serial items
                }
                
                # Handle serial/batch bundles for items with tracking
                bundle_name = None
                if (item_details and (item_details.has_serial_no or item_details.has_batch_no)) and physical_qty > 0:
                    # Create Serial and Batch Bundle for new stock
                    serial_nos = item.get("serial_nos") or item.get("serial_no") or []
                    batch_no = item.get("batch_no")
                    
                    if isinstance(serial_nos, str):
                        serial_nos = [s.strip() for s in serial_nos.split(',')]
                    
                    # Create bundle document
                    bundle = frappe.get_doc({
                        "doctype": "Serial and Batch Bundle",
                        "item_code": item_code,
                        "warehouse": warehouse,
                        "bundle_type": "Inward",  # Always Inward for reconciliation adding stock
                        "entries": []
                    })
                    
                    # Add serial/batch entries
                    if item_details.has_serial_no and serial_nos:
                        for serial_no in serial_nos:
                            bundle.append("entries", {
                                "serial_no": serial_no,
                                "batch_no": batch_no if item_details.has_batch_no else None,
                                "qty": 1
                            })
                    elif item_details.has_batch_no and batch_no:
                        # Batch only item
                        bundle.append("entries", {
                            "batch_no": batch_no,
                            "qty": physical_qty
                        })
                    
                    if bundle.entries:
                        bundle.insert()
                        bundle_name = bundle.name
                        item_data["serial_and_batch_bundle"] = bundle_name
                        frappe.logger().info(f"Created Serial and Batch Bundle {bundle_name} for item {item_code}")
                
                # For decreasing stock with existing serials, specify serial_no directly
                elif item_details and item_details.has_serial_no and physical_qty < system_qty:
                    serial_nos = item.get("serial_nos") or item.get("serial_no")
                    if serial_nos:
                        if isinstance(serial_nos, list):
                            serial_nos = ", ".join(serial_nos)
                        item_data["serial_no"] = serial_nos
                
                # Handle batch for decreasing stock
                if item_details and item_details.has_batch_no and physical_qty < system_qty:
                    batch_no = item.get("batch_no")
                    if batch_no:
                        item_data["batch_no"] = batch_no
                
                sr.append("items", item_data)
        
        frappe.logger().info(f"Stock Reconciliation has {len(sr.items)} items with differences")
        
        if not sr.items:
            frappe.logger().warn("No items with differences found")
            frappe.throw(_("No items with quantity differences found"))
        
        sr.insert()
        sr.submit()
        frappe.db.commit()
        
        frappe.response["message"] = {"name": sr.name}
        frappe.response["http_status_code"] = 200
        
    except Exception as e:
        frappe.response["message"] = str(e)
        frappe.response["http_status_code"] = 400
        frappe.log_error(f"Error creating stock reconciliation: {str(e)}")

@frappe.whitelist()
def get_stock_reconciliations(cost_center, warehouse_context=None):
    """Get stock reconciliations for a cost center and mini-warehouse dashboard."""
    if not cost_center:
        frappe.throw(_("Cost Center is required"))

    sr_fields = ["name", "posting_date", "owner", "purpose", "docstatus"]
    if frappe.get_meta("Stock Reconciliation").has_field("custom_notes"):
        sr_fields.append("custom_notes as notes")

    reconciliations = frappe.get_all(
        "Stock Reconciliation",
        filters={"cost_center": cost_center, **_inventory_context_filters("Stock Reconciliation", warehouse_context)},
        fields=sr_fields,
        order_by="creation desc",
        limit=50,
    )
    
    for rec in reconciliations:
        rec["items"] = _filter_rows_by_nhra_item(
            frappe.get_all(
                "Stock Reconciliation Item",
                filters={"parent": rec["name"]},
                fields=["item_code", "item_name", "qty", "current_qty", "warehouse"],
            ),
            warehouse_context=warehouse_context,
        )
    
    frappe.response["message"] = reconciliations

@frappe.whitelist()
def get_item_batches(item_code, warehouse):
    """Return batches with positive qty for an item in a specific warehouse only.

    Uses ERPNext ``get_batch_qty`` for warehouse balance. Never falls back to
    Batch.batch_qty (company-wide), which caused pharmacy give-out to pick
    batches that have zero stock at the selected warehouse.
    """
    from erpnext.stock.doctype.batch.batch import get_batch_qty

    if not item_code or not warehouse:
        return []

    batches = frappe.get_all(
        "Batch",
        filters={"item": item_code},
        fields=["name", "batch_id", "expiry_date", "manufacturing_date"],
    )

    batch_qty_data = []
    for batch in batches:
        batch_name = batch.name
        batch_id = (batch.batch_id or batch_name or "").strip()
        qty = flt(get_batch_qty(batch_no=batch_name, warehouse=warehouse) or 0)
        if qty <= 0 and batch_id and batch_id != batch_name:
            qty = flt(get_batch_qty(batch_no=batch_id, warehouse=warehouse) or 0)
        if qty > 0:
            batch_qty_data.append(
                {
                    "batch_id": batch_id or batch_name,
                    "batch_name": batch_name,
                    "qty": qty,
                    "expiry_date": batch.expiry_date,
                    "manufacturing_date": batch.manufacturing_date,
                }
            )

    return batch_qty_data


@frappe.whitelist()
def get_batch_quantity_from_bundles(batch_no, warehouse):
    """
    Get total quantity for a batch from Serial and Batch Bundles
    """
    if not batch_no or not warehouse:
        return 0
    
    # Query Serial and Batch Bundle to get total quantity
    result = frappe.db.sql("""
        SELECT 
            SUM(sabb.total_qty) as total_qty
        FROM `tabSerial and Batch Bundle` sabb
        INNER JOIN `tabSerial and Batch Entry` sbe ON sbe.parent = sabb.name
        WHERE sbe.batch_no = %s 
            AND sabb.warehouse = %s
            AND sabb.docstatus = 1
            AND sabb.is_cancelled = 0
    """, (batch_no, warehouse), as_dict=1)
    
    if result and result[0].get('total_qty') and result[0]['total_qty'] is not None:
        return abs(result[0]['total_qty'])
    
    return 0

@frappe.whitelist()
def get_item_serials(item_code, warehouse):
    """
    Returns a list of available Serial Nos for a given item and warehouse.
    Gets serials from Serial and Batch Bundle entries.
    """
    if not item_code or not warehouse:
        return []
    
    print(f"Getting serials for item: {item_code}, warehouse: {warehouse}")
    
    # Get serials from Serial and Batch Bundle entries
    result = frappe.db.sql("""
        SELECT DISTINCT
            sbe.serial_no
        FROM `tabSerial and Batch Bundle` sabb
        INNER JOIN `tabSerial and Batch Entry` sbe ON sbe.parent = sabb.name
        WHERE sbe.item_code = %s 
            AND sabb.warehouse = %s
            AND sabb.docstatus = 1
            AND sabb.is_cancelled = 0
            AND sbe.serial_no IS NOT NULL
            AND sbe.serial_no != ''
        ORDER BY sabb.modified DESC
        LIMIT 500
    """, (item_code, warehouse), as_dict=1)
    
    serials = []
    for row in result:
        if row.serial_no:
            serials.append(row.serial_no)
    
    print(f"Found {len(serials)} serials for item {item_code}")
    return serials

@frappe.whitelist()
def get_batch_details_with_serials(batch_no, warehouse):
    """
    Get all serial numbers for a specific batch in a warehouse
    """
    if not batch_no or not warehouse:
        return []
    
    # Get all serials for this batch from bundles
    result = frappe.db.sql("""
        SELECT 
            sbe.serial_no,
            sbe.qty,
            sabb.name as bundle_name,
            sabb.voucher_type,
            sabb.voucher_no
        FROM `tabSerial and Batch Bundle` sabb
        INNER JOIN `tabSerial and Batch Entry` sbe ON sbe.parent = sabb.name
        WHERE sbe.batch_no = %s 
            AND sabb.warehouse = %s
            AND sabb.docstatus = 1
            AND sabb.is_cancelled = 0
            AND sbe.serial_no IS NOT NULL
            AND sbe.serial_no != ''
        ORDER BY sabb.modified DESC
    """, (batch_no, warehouse), as_dict=1)
    
    return result
@frappe.whitelist()
def create_material_receipt():
    """
    Create Purchase Receipt for materials.
    
    Warehouse is automatically set from Healthcare Settings based on cost_center.
    Only Administrators and System Managers can override the warehouse.
    
    Expects POST data:
    {
        "cost_center": "Cost Center Name",
        "warehouse": "Warehouse Name (optional - only for admin/system manager)",
        "receipt_date": "2024-01-01",
        "supplier": "Supplier Name",
        "invoice_number": "INV-001",
        "items": [
            {
                "item_code": "ITEM001",
                "item_name": "Item Name",
                "quantity": 10,
                "unit_price": 100,
                "total_price": 1000,
                "batch_number": "BATCH001",
                "expiry_date": "2025-12-31"
            }
        ],
        "total_amount": 1000,
        "received_by": "User Name"
    }
    """
    try:
        data = frappe.local.form_dict
        if not data:
            data = json.loads(frappe.request.data)
        
        cost_center = data.get("cost_center")
        user_provided_warehouse = data.get("warehouse")
        
        if not cost_center:
            frappe.throw(_("Cost Center is required"))
        
        # Get warehouse from Healthcare Settings
        warehouse = _warehouse_for_cost_center(cost_center, data.get("warehouse_context"))
        
        # If user is trying to override warehouse, validate permission
        if user_provided_warehouse and user_provided_warehouse != warehouse:
            validate_warehouse_change_permission()
            warehouse = user_provided_warehouse
        
        if not warehouse:
            frappe.throw(_("No warehouse found for cost center {0} in Healthcare Settings").format(cost_center))
        
        company = _company_for_cost_center(cost_center, warehouse)
        if not company:
            frappe.throw(
                _("Company could not be resolved for cost center {0}. Set Company on the Cost Center in ERPNext.").format(
                    cost_center
                )
            )

        se = frappe.new_doc("Stock Entry")
        se.stock_entry_type = "Material Receipt"
        se.purpose = "Material Receipt"
        se.company = company
        se.posting_date = data.get("receipt_date", today())
        if hasattr(se, "to_warehouse"):
            se.to_warehouse = warehouse
        _apply_mini_warehouse_metadata(
            se,
            data.get("warehouse_context"),
            data.get("notes") or data.get("custom_notes"),
        )
        _apply_stock_entry_branch(se, cost_center)

        for item in data.get("items", []):
            if item.get("item_code") and flt(item.get("quantity")) > 0:
                _assert_nhra_item_for_nursing_inventory(item.get("item_code"), data.get("warehouse_context"))
                item_details = frappe.db.get_value(
                    "Item",
                    item.get("item_code"),
                    ["stock_uom", "item_name"],
                    as_dict=True,
                )
                batch_number = item.get("batch_number")
                se.append(
                    "items",
                    {
                        "item_code": item.get("item_code"),
                        "item_name": item.get("item_name") or (item_details and item_details.item_name),
                        "qty": item.get("quantity"),
                        "uom": item_details.stock_uom if item_details else None,
                        "basic_rate": item.get("unit_price"),
                        "t_warehouse": warehouse,
                        "cost_center": cost_center,
                        **_stock_entry_row_serial_batch_fields(item.get("item_code"), batch_number),
                    },
                )

        if not se.items:
            frappe.throw(_("At least one item is required"))

        _apply_stock_entry_serial_batch_fields(se)
        se.insert()
        se.submit()
        frappe.db.commit()

        frappe.response["message"] = {"name": se.name}
        frappe.response["http_status_code"] = 200
        
    except Exception as e:
        frappe.response["message"] = str(e)
        frappe.response["http_status_code"] = 400
        frappe.log_error(f"Error creating material receipt: {str(e)}")

@frappe.whitelist()
def get_material_receipts(cost_center, warehouse_context=None):
    """
    Get material transfers (Stock Entries) for a cost center.

    Uses the configured mini warehouse (nurse or laboratory) for the cost center.
    """
    if not cost_center:
        frappe.throw(_("Cost Center is required"))

    warehouse = _warehouse_for_cost_center(cost_center, warehouse_context)
    
    if not warehouse:
        frappe.response["message"] = []
        return
    se_fields = [
        "name",
        "posting_date as transfer_date",
        "from_warehouse",
        "to_warehouse",
        "total_outgoing_value as total_amount",
        "owner as transferred_by",
        "stock_entry_type",
        "purpose",
    ]
    if frappe.get_meta("Stock Entry").has_field("custom_notes"):
        se_fields.append("custom_notes as notes")

    transfers = frappe.get_all(
        "Stock Entry",
        filters={
            "docstatus": 1,
            "to_warehouse": warehouse,
            **_inventory_context_filters("Stock Entry", warehouse_context),
        },
        fields=se_fields,
        order_by="creation desc",
        limit=50,
    )
    # frappe.throw("Uko wapi", str(transfers))
    for transfer in transfers:
        transfer["items"] = _filter_rows_by_nhra_item(
            frappe.get_all(
                "Stock Entry Detail",
                filters={"parent": transfer["name"]},
                fields=[
                    "item_code",
                    "item_name",
                    "qty as quantity",
                    "basic_rate as unit_price",
                    "amount as total_price",
                    "batch_no as batch_number",
                ],
            ),
            warehouse_context=warehouse_context,
        )
    
    frappe.response["message"] = transfers


def _stock_transfer_source_warehouses(cost_center, warehouse_context=None):
	"""Mini warehouse for the branch, then configured default, then company warehouses."""
	ctx = normalize_mini_warehouse_context(warehouse_context)
	warehouses = list(get_cc_warehouses(cost_center, warehouse_context=ctx) or [])
	if warehouses:
		return warehouses

	default_wh = get_warehouse_for_cost_center(cost_center, warehouse_context=ctx)
	if default_wh:
		return [{"name": default_wh, "label": default_wh}]

	company = _company_for_cost_center(cost_center)
	filters = {"disabled": 0}
	if company:
		filters["company"] = company

	rows = frappe.get_all(
		"Warehouse",
		filters=filters,
		fields=["name", "warehouse_name", "is_group"],
		order_by="warehouse_name asc",
		limit=100,
	)
	return [
		{"name": row.name, "label": row.warehouse_name or row.name}
		for row in rows
		if not cint(row.get("is_group"))
	]


def _stock_transfer_destination_warehouses(cost_center, source_warehouse=None, search=None, warehouse_context=None):
	"""All leaf warehouses in the company except the source mini warehouse."""
	source = (source_warehouse or "").strip()
	if not source:
		sources = _stock_transfer_source_warehouses(cost_center, warehouse_context)
		source = sources[0]["name"] if sources else ""

	company = _company_for_cost_center(cost_center, source)
	filters = {"disabled": 0}
	if company:
		filters["company"] = company

	or_filters = None
	search = (search or "").strip()
	if search:
		or_filters = {
			"name": ["like", f"%{search}%"],
			"warehouse_name": ["like", f"%{search}%"],
		}

	rows = frappe.get_all(
		"Warehouse",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "warehouse_name", "is_group"],
		order_by="warehouse_name asc",
		limit=200,
	)

	if not rows and company:
		rows = frappe.get_all(
			"Warehouse",
			filters={"disabled": 0},
			or_filters=or_filters,
			fields=["name", "warehouse_name", "is_group"],
			order_by="warehouse_name asc",
			limit=200,
		)

	out = []
	for row in rows:
		if cint(row.get("is_group")):
			continue
		if source and row.name == source:
			continue
		out.append({"name": row.name, "label": row.warehouse_name or row.name})
	return out


@frappe.whitelist()
def get_stock_transfer_warehouse_options(cost_center, source_warehouse=None, warehouse_context=None, search=None):
	"""Source + destination warehouse lists for the stock transfer modal."""
	if not cost_center:
		frappe.throw(_("Cost Center is required"))

	source_warehouses = _stock_transfer_source_warehouses(cost_center, warehouse_context)
	source = (source_warehouse or "").strip()
	if not source and source_warehouses:
		source = source_warehouses[0]["name"]
	elif source and not any(row["name"] == source for row in source_warehouses):
		source_warehouses.insert(0, {"name": source, "label": source})

	destinations = _stock_transfer_destination_warehouses(
		cost_center,
		source,
		search=search,
		warehouse_context=warehouse_context,
	)

	return {
		"source_warehouses": source_warehouses,
		"default_source": source,
		"destination_warehouses": destinations,
	}


@frappe.whitelist()
def get_stock_transfer_destination_warehouses(cost_center, source_warehouse=None, warehouse_context=None, search=None):
	"""List destination warehouses for outbound stock transfers (excludes the mini source warehouse)."""
	if not cost_center:
		frappe.throw(_("Cost Center is required"))

	return _stock_transfer_destination_warehouses(
		cost_center,
		source_warehouse,
		search=search,
		warehouse_context=warehouse_context,
	)


@frappe.whitelist()
def create_stock_transfer():
	"""Transfer stock out of the mini warehouse to another warehouse (Stock Entry — Material Transfer)."""
	try:
		data = frappe.local.form_dict
		if not data:
			data = json.loads(frappe.request.data)

		cost_center = data.get("cost_center")
		if not cost_center:
			frappe.throw(_("Cost Center is required"))

		user_provided_source = (data.get("from_warehouse") or data.get("warehouse") or "").strip()
		source_warehouse = _warehouse_for_cost_center(cost_center, data.get("warehouse_context"))
		if user_provided_source and user_provided_source != source_warehouse:
			validate_warehouse_change_permission()
			source_warehouse = user_provided_source
		if not source_warehouse:
			frappe.throw(_("No source warehouse found for cost center {0} in Healthcare Settings").format(cost_center))

		to_warehouse = (data.get("to_warehouse") or "").strip()
		if not to_warehouse:
			frappe.throw(_("Destination warehouse is required"))
		if to_warehouse == source_warehouse:
			frappe.throw(_("Destination warehouse must be different from the source warehouse"))

		company = _company_for_cost_center(cost_center, source_warehouse)
		if not company:
			frappe.throw(
				_("Company could not be resolved for cost center {0}. Set Company on the Cost Center in ERPNext.").format(
					cost_center
				)
			)

		se = frappe.new_doc("Stock Entry")
		se.stock_entry_type = "Material Transfer"
		se.purpose = "Material Transfer"
		se.company = company
		se.posting_date = data.get("transfer_date", today())
		if hasattr(se, "from_warehouse"):
			se.from_warehouse = source_warehouse
		if hasattr(se, "to_warehouse"):
			se.to_warehouse = to_warehouse
		_apply_mini_warehouse_metadata(
			se,
			data.get("warehouse_context"),
			data.get("notes") or data.get("custom_notes"),
		)
		_apply_stock_entry_branch(se, cost_center)

		from healthcare.api.medicine_given import _validate_medicine_given_batch_lot

		se_item_meta = frappe.get_meta("Stock Entry Detail")
		has_dispensing_field = se_item_meta.has_field("custom_dispensing_lot")

		for item in data.get("items") or []:
			item_code = (item.get("item_code") or "").strip()
			qty = flt(item.get("quantity"))
			if not item_code or qty <= 0:
				continue

			item_details = frappe.db.get_value(
				"Item",
				item_code,
				["item_name", "stock_uom"],
				as_dict=True,
			)
			if not item_details:
				frappe.throw(_("Item {0} not found").format(item_code))
			_assert_nhra_item_for_nursing_inventory(item_code, data.get("warehouse_context"))

			uom = (item.get("uom") or "").strip() or item_details.stock_uom
			batch_no = (item.get("batch_number") or item.get("batch_no") or "").strip() or None
			dispensing_lot = (item.get("dispensing_lot") or "").strip() or None

			_validate_medicine_given_batch_lot(
				item_code,
				"",
				batch_no,
				None,
				dispensing_lot,
				warehouse=source_warehouse,
			)

			row = {
				"item_code": item_code,
				"item_name": item.get("item_name") or item_details.item_name,
				"qty": qty,
				"uom": uom,
				"s_warehouse": source_warehouse,
				"t_warehouse": to_warehouse,
				"cost_center": cost_center,
				**_stock_entry_row_serial_batch_fields(item_code, batch_no),
			}
			if batch_no and "batch_no" not in row:
				row["batch_no"] = batch_no
			if has_dispensing_field and dispensing_lot:
				row["custom_dispensing_lot"] = dispensing_lot
			se.append("items", row)

		if not se.items:
			frappe.throw(_("At least one item is required"))

		_prepare_stock_entry_before_submit(se)
		_bind_stock_entry_rate_preserver(se)
		se.insert()
		se.submit()
		frappe.db.commit()

		frappe.response["message"] = {"name": se.name}
		frappe.response["http_status_code"] = 200
	except Exception as e:
		frappe.response["message"] = str(e)
		frappe.response["http_status_code"] = 400
		frappe.log_error(f"Error creating stock transfer: {str(e)}")


def _stock_transfer_entry_names(cost_center, warehouse_context=None, limit=50):
	"""Stock Entry names for outbound material transfers tied to a branch."""
	source_warehouses = [
		row["name"]
		for row in _stock_transfer_source_warehouses(cost_center, warehouse_context)
		if row.get("name")
	]
	default_wh = _warehouse_for_cost_center(cost_center, warehouse_context)
	if default_wh and default_wh not in source_warehouses:
		source_warehouses.append(default_wh)

	warehouse_clause = ""
	params = {"cost_center": cost_center, "limit": cint(limit)}
	if source_warehouses:
		warehouse_clause = """
			OR parent.from_warehouse IN %(warehouses)s
			OR child.s_warehouse IN %(warehouses)s
		"""
		params["warehouses"] = tuple(source_warehouses)

	rows = frappe.db.sql(
		f"""
		SELECT parent.name
		FROM `tabStock Entry` parent
		LEFT JOIN `tabStock Entry Detail` child ON child.parent = parent.name
		WHERE parent.docstatus = 1
			AND parent.purpose = 'Material Transfer'
			AND (
				parent.cost_center = %(cost_center)s
				OR child.cost_center = %(cost_center)s
				{warehouse_clause}
			)
		GROUP BY parent.name
		ORDER BY MAX(parent.creation) DESC
		LIMIT %(limit)s
		""",
		params,
		as_dict=True,
	)
	return [row.name for row in rows]


@frappe.whitelist()
def get_stock_transfers(cost_center, warehouse_context=None):
	"""List submitted material transfers out of branch / mini warehouses."""
	if not cost_center:
		frappe.throw(_("Cost Center is required"))

	names = _stock_transfer_entry_names(cost_center, warehouse_context)
	if not names:
		frappe.response["message"] = []
		return

	se_fields = [
		"name",
		"posting_date as transfer_date",
		"from_warehouse",
		"to_warehouse",
		"total_outgoing_value as total_amount",
		"owner as transferred_by",
		"stock_entry_type",
		"purpose",
		"cost_center",
	]
	if frappe.get_meta("Stock Entry").has_field("custom_notes"):
		se_fields.append("custom_notes as notes")

	transfers = frappe.get_all(
		"Stock Entry",
		filters={"name": ["in", names]},
		fields=se_fields,
		order_by="creation desc",
		limit=50,
	)

	se_item_fields = [
		"item_code",
		"item_name",
		"qty as quantity",
		"uom",
		"s_warehouse",
		"t_warehouse",
		"basic_rate as unit_price",
		"amount as total_price",
		"batch_no as batch_number",
	]
	if frappe.get_meta("Stock Entry Detail").has_field("custom_dispensing_lot"):
		se_item_fields.append("custom_dispensing_lot as dispensing_lot")

	for transfer in transfers:
		transfer["items"] = _filter_rows_by_nhra_item(
			frappe.get_all(
				"Stock Entry Detail",
				filters={"parent": transfer["name"]},
				fields=se_item_fields,
			),
			warehouse_context=warehouse_context,
		)
		if not transfer.get("from_warehouse"):
			for line in transfer["items"]:
				if line.get("s_warehouse"):
					transfer["from_warehouse"] = line["s_warehouse"]
					break
		if not transfer.get("to_warehouse"):
			for line in transfer["items"]:
				if line.get("t_warehouse"):
					transfer["to_warehouse"] = line["t_warehouse"]
					break

	frappe.response["message"] = transfers


@frappe.whitelist()
def create_material_issue():
	"""Issue stock out of the mini warehouse (Stock Entry - Material Issue)."""
	try:
		data = frappe.local.form_dict
		if not data:
			data = json.loads(frappe.request.data)

		cost_center = data.get("cost_center")
		if not cost_center:
			frappe.throw(_("Cost Center is required"))

		user_provided_source = (data.get("from_warehouse") or data.get("warehouse") or "").strip()
		source_warehouse = _warehouse_for_cost_center(cost_center, data.get("warehouse_context"))
		if user_provided_source and user_provided_source != source_warehouse:
			validate_warehouse_change_permission()
			source_warehouse = user_provided_source
		if not source_warehouse:
			frappe.throw(_("No source warehouse found for cost center {0} in Healthcare Settings").format(cost_center))

		company = _company_for_cost_center(cost_center, source_warehouse)
		if not company:
			frappe.throw(
				_("Company could not be resolved for cost center {0}. Set Company on the Cost Center in ERPNext.").format(
					cost_center
				)
			)

		se = frappe.new_doc("Stock Entry")
		se.stock_entry_type = "Material Issue"
		se.purpose = "Material Issue"
		se.company = company
		se.posting_date = data.get("issue_date", today())
		if hasattr(se, "from_warehouse"):
			se.from_warehouse = source_warehouse
		_apply_mini_warehouse_metadata(
			se,
			data.get("warehouse_context"),
			data.get("notes") or data.get("custom_notes"),
		)
		_apply_stock_entry_branch(se, cost_center)

		from healthcare.api.medicine_given import _validate_medicine_given_batch_lot

		se_item_meta = frappe.get_meta("Stock Entry Detail")
		has_dispensing_field = se_item_meta.has_field("custom_dispensing_lot")

		for item in data.get("items") or []:
			item_code = (item.get("item_code") or "").strip()
			qty = flt(item.get("quantity"))
			if not item_code or qty <= 0:
				continue

			item_details = frappe.db.get_value(
				"Item",
				item_code,
				["item_name", "stock_uom"],
				as_dict=True,
			)
			if not item_details:
				frappe.throw(_("Item {0} not found").format(item_code))
			_assert_nhra_item_for_nursing_inventory(item_code, data.get("warehouse_context"))

			uom = (item.get("uom") or "").strip() or item_details.stock_uom
			batch_no = (item.get("batch_number") or item.get("batch_no") or "").strip() or None
			dispensing_lot = (item.get("dispensing_lot") or "").strip() or None

			_validate_medicine_given_batch_lot(
				item_code,
				"",
				batch_no,
				None,
				dispensing_lot,
				warehouse=source_warehouse,
			)

			row = {
				"item_code": item_code,
				"item_name": item.get("item_name") or item_details.item_name,
				"qty": qty,
				"uom": uom,
				"s_warehouse": source_warehouse,
				"cost_center": cost_center,
				**_stock_entry_row_serial_batch_fields(item_code, batch_no),
			}
			if batch_no and "batch_no" not in row:
				row["batch_no"] = batch_no
			if has_dispensing_field and dispensing_lot:
				row["custom_dispensing_lot"] = dispensing_lot
			se.append("items", row)

		if not se.items:
			frappe.throw(_("At least one item is required"))

		_prepare_stock_entry_before_submit(se)
		_bind_stock_entry_rate_preserver(se)
		se.insert()
		se.submit()
		frappe.db.commit()

		frappe.response["message"] = {"name": se.name}
		frappe.response["http_status_code"] = 200
	except Exception as e:
		frappe.response["message"] = str(e)
		frappe.response["http_status_code"] = 400
		frappe.log_error(f"Error creating material issue: {str(e)}")


def _stock_issue_entry_names(cost_center, warehouse_context=None, limit=50):
	"""Stock Entry names for material issues tied to a branch mini warehouse."""
	source_warehouses = [
		row["name"]
		for row in _stock_transfer_source_warehouses(cost_center, warehouse_context)
		if row.get("name")
	]
	default_wh = _warehouse_for_cost_center(cost_center, warehouse_context)
	if default_wh and default_wh not in source_warehouses:
		source_warehouses.append(default_wh)

	warehouse_clause = ""
	params = {"cost_center": cost_center, "limit": cint(limit)}
	if source_warehouses:
		warehouse_clause = """
			OR parent.from_warehouse IN %(warehouses)s
			OR child.s_warehouse IN %(warehouses)s
		"""
		params["warehouses"] = tuple(source_warehouses)

	rows = frappe.db.sql(
		f"""
		SELECT parent.name
		FROM `tabStock Entry` parent
		LEFT JOIN `tabStock Entry Detail` child ON child.parent = parent.name
		WHERE parent.docstatus = 1
			AND parent.purpose = 'Material Issue'
			AND (
				parent.cost_center = %(cost_center)s
				OR child.cost_center = %(cost_center)s
				{warehouse_clause}
			)
		GROUP BY parent.name
		ORDER BY MAX(parent.creation) DESC
		LIMIT %(limit)s
		""",
		params,
		as_dict=True,
	)
	return [row.name for row in rows]


@frappe.whitelist()
def get_material_issues(cost_center, warehouse_context=None):
	"""List submitted material issues out of branch or mini warehouses."""
	if not cost_center:
		frappe.throw(_("Cost Center is required"))

	names = _stock_issue_entry_names(cost_center, warehouse_context)
	if not names:
		frappe.response["message"] = []
		return

	se_fields = [
		"name",
		"posting_date as issue_date",
		"from_warehouse",
		"total_outgoing_value as total_amount",
		"owner as issued_by",
		"stock_entry_type",
		"purpose",
		"cost_center",
	]
	if frappe.get_meta("Stock Entry").has_field("custom_notes"):
		se_fields.append("custom_notes as notes")

	issues = frappe.get_all(
		"Stock Entry",
		filters={"name": ["in", names]},
		fields=se_fields,
		order_by="creation desc",
		limit=50,
	)

	se_item_fields = [
		"item_code",
		"item_name",
		"qty as quantity",
		"uom",
		"s_warehouse",
		"basic_rate as unit_price",
		"amount as total_price",
		"batch_no as batch_number",
	]
	if frappe.get_meta("Stock Entry Detail").has_field("custom_dispensing_lot"):
		se_item_fields.append("custom_dispensing_lot as dispensing_lot")

	for issue in issues:
		issue["items"] = _filter_rows_by_nhra_item(
			frappe.get_all(
				"Stock Entry Detail",
				filters={"parent": issue["name"]},
				fields=se_item_fields,
			),
			warehouse_context=warehouse_context,
		)
		if not issue.get("from_warehouse"):
			for line in issue["items"]:
				if line.get("s_warehouse"):
					issue["from_warehouse"] = line["s_warehouse"]
					break

	frappe.response["message"] = issues

@frappe.whitelist()
def get_user_cost_centers():
    """
    Get cost centers assigned to the current user
    """
    user = frappe.session.user
    
    # Get cost centers from user permissions
    cost_centers = frappe.db.sql("""
        SELECT DISTINCT 
            cc.name,
            cc.cost_center_name as label
        FROM `tabCost Center` cc
        WHERE cc.name IN (
            SELECT DISTINCT for_value 
            FROM `tabUser Permission` 
            WHERE user = %s AND allow = 'Cost Center'
        )
        OR cc.parent_cost_center IN (
            SELECT DISTINCT for_value 
            FROM `tabUser Permission` 
            WHERE user = %s AND allow = 'Cost Center'
        )
        LIMIT 10
    """, (user, user), as_dict=1)
    
    if not cost_centers:
        # Fallback: get cost centers from employee record
        employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
        if employee:
            employee_cost_center = frappe.db.get_value("Employee", employee, "cost_center")
            if employee_cost_center:
                cost_centers = [{
                    "name": employee_cost_center,
                    "label": frappe.db.get_value("Cost Center", employee_cost_center, "cost_center_name")
                }]
    
    # If still no cost centers, return some default ones for testing
    if not cost_centers:
        cost_centers = frappe.get_all("Cost Center", 
            filters={"is_group": 0},
            fields=["name", "cost_center_name as label"], 
            limit=10)
    
    frappe.response["message"] = cost_centers
    
def _aggregate_medicine_given_items(given_rows):
    """Sum qty per item code from unbilled Medicine Given child rows."""
    items = {}
    row_names = []
    for row in given_rows or []:
        row_name = (row.get("name") or "").strip()
        code = (row.get("medicine_code") or "").strip()
        qty = flt(row.get("qty"))
        if not code or qty <= 0:
            continue
        if row_name:
            row_names.append(row_name)
        if code not in items:
            items[code] = {
                "qty": 0,
                "name": (row.get("medicine_name") or code).strip() or code,
            }
        items[code]["qty"] += qty
    return items, row_names


def _group_medicine_given_for_billing(given_rows):
    """Group unbilled given rows by item + batch + dispensing lot + unit for SO/DN lines."""
    groups = []
    index = {}
    for row in given_rows or []:
        code = (row.get("medicine_code") or "").strip()
        qty = flt(row.get("qty"))
        if not code or qty <= 0:
            continue
        batch_no = (row.get("batch_no") or "").strip()
        dispensing_lot = (row.get("dispensing_lot") or "").strip()
        lot_no = (row.get("lot_no") or "").strip()
        unit = (row.get("unit") or "").strip()
        key = (code, batch_no, dispensing_lot, lot_no, unit)
        if key not in index:
            index[key] = len(groups)
            groups.append(
                {
                    "medicine_code": code,
                    "medicine_name": (row.get("medicine_name") or code).strip() or code,
                    "qty": 0,
                    "unit": unit or None,
                    "batch_no": batch_no or None,
                    "dispensing_lot": dispensing_lot or None,
                    "lot_no": lot_no or None,
                    "row_names": [],
                }
            )
        group = groups[index[key]]
        group["qty"] += qty
        if row.get("name"):
            group["row_names"].append(row["name"])
    return groups


def _apply_medicine_tracking_to_delivery_note(dn, billing_groups):
    """Set batch_no and custom_dispensing_lot on Delivery Note items from given medicine groups."""
    if not dn or not billing_groups:
        return

    dn_item_meta = frappe.get_meta("Delivery Note Item")
    has_batch_field = dn_item_meta.has_field("batch_no")
    has_dispensing_field = dn_item_meta.has_field("custom_dispensing_lot")

    pending = {}
    for group in billing_groups:
        code = group.get("medicine_code")
        pending.setdefault(code, []).append(group)

    for dn_row in dn.get("items") or []:
        code = dn_row.item_code
        candidates = pending.get(code) or []
        if not candidates:
            continue
        group = candidates.pop(0)
        if has_batch_field and group.get("batch_no"):
            dn_row.batch_no = group["batch_no"]
        if has_dispensing_field and group.get("dispensing_lot"):
            dn_row.custom_dispensing_lot = group["dispensing_lot"]


def _needed_stock_qty_for_dn_row(row) -> float:
    stock_qty = flt(getattr(row, "stock_qty", None) or 0)
    if stock_qty > 0:
        return stock_qty
    qty = flt(getattr(row, "qty", 0))
    conversion = flt(getattr(row, "conversion_factor", None) or 0) or 1
    return qty * conversion


def _pick_random_batch_for_warehouse(item_code, warehouse, needed_qty):
    """Pick a random in-stock batch at the warehouse, preferring enough qty."""
    import random

    batches = get_item_batches(item_code, warehouse) or []
    enough = [b for b in batches if flt(b.get("qty")) + 1e-9 >= flt(needed_qty)]
    pool = enough or [b for b in batches if flt(b.get("qty")) > 0]
    if not pool:
        return None
    chosen = random.choice(pool)
    return (chosen.get("batch_name") or chosen.get("batch_id") or "").strip() or None


def _pick_random_serials_for_warehouse(item_code, warehouse, qty, batch_no=None):
    """Pick random available serials covering qty (one serial per stock unit)."""
    import random

    needed = max(cint(round(flt(qty))), 1)
    serials: list[str] = []
    if batch_no:
        rows = get_batch_details_with_serials(batch_no, warehouse) or []
        serials = [(r.get("serial_no") or "").strip() for r in rows if r.get("serial_no")]
    if not serials:
        serials = [(s or "").strip() for s in (get_item_serials(item_code, warehouse) or []) if s]
    if not serials and frappe.db.exists("DocType", "Serial No"):
        serials = frappe.get_all(
            "Serial No",
            filters={"item_code": item_code, "warehouse": warehouse},
            pluck="name",
            limit_page_length=500,
        )
    serials = [s for s in serials if s]
    if len(serials) < needed:
        return None
    picked = random.sample(serials, needed)
    return "\n".join(picked)


def _fill_missing_delivery_note_batch_serial(dn):
    """Auto-assign warehouse batch/serial when given-medicine rows did not record one."""
    dn_item_meta = frappe.get_meta("Delivery Note Item")
    has_batch_field = dn_item_meta.has_field("batch_no")
    has_serial_field = dn_item_meta.has_field("serial_no")
    has_use_fields = dn_item_meta.has_field("use_serial_batch_fields")

    for row in dn.get("items") or []:
        item_code = (getattr(row, "item_code", None) or "").strip()
        warehouse = (getattr(row, "warehouse", None) or getattr(dn, "set_warehouse", None) or "").strip()
        if not item_code or not warehouse or flt(getattr(row, "qty", 0)) <= 0:
            continue
        if not cint(frappe.get_cached_value("Item", item_code, "is_stock_item")):
            continue

        has_batch, has_serial = False, False
        flags = frappe.db.get_value("Item", item_code, ["has_batch_no", "has_serial_no"], as_dict=True)
        if flags:
            has_batch = bool(cint(flags.has_batch_no))
            has_serial = bool(cint(flags.has_serial_no))
        if not has_batch and not has_serial:
            continue

        if has_use_fields:
            row.use_serial_batch_fields = 1
            if hasattr(row, "serial_and_batch_bundle"):
                row.serial_and_batch_bundle = None

        needed = _needed_stock_qty_for_dn_row(row)
        if has_batch and has_batch_field and not (getattr(row, "batch_no", None) or "").strip():
            picked_batch = _pick_random_batch_for_warehouse(item_code, warehouse, needed)
            if picked_batch:
                row.batch_no = picked_batch

        if has_serial and has_serial_field and not (getattr(row, "serial_no", None) or "").strip():
            picked_serials = _pick_random_serials_for_warehouse(
                item_code,
                warehouse,
                needed,
                batch_no=(getattr(row, "batch_no", None) or "").strip() or None,
            )
            if picked_serials:
                row.serial_no = picked_serials

        missing = []
        if has_batch and has_batch_field and not (getattr(row, "batch_no", None) or "").strip():
            missing.append(_("batch"))
        if has_serial and has_serial_field and not (getattr(row, "serial_no", None) or "").strip():
            missing.append(_("serial no"))
        if missing:
            frappe.throw(
                _("No {0} in stock for {1} at warehouse {2}. Add stock or record batch/serial on Given Medicine.").format(
                    " / ".join(missing),
                    item_code,
                    warehouse,
                )
            )


def _validate_delivery_note_dispensing_lots(dn):
    """Validate dispensing lots on DN using beveren_health rules when installed."""
    try:
        from beveren_health.beveren_health.customize.dispensing_lot import validate_sales_invoice_dispensing_lots
    except ImportError:
        return
    validate_sales_invoice_dispensing_lots(dn)


def _process_delivery_note_dispensing_lots(dn):
    """Post dispensing lot Out transactions when DN is submitted (beveren_health)."""
    try:
        from beveren_health.beveren_health.customize.dispensing_lot import process_sales_invoice_dispensing_lots
    except ImportError:
        return
    process_sales_invoice_dispensing_lots(dn, is_return=False)


def _unbilled_medicine_given_filters(admission_detail_name, consumption_date=None):
    filters = {
        "parent": admission_detail_name,
        "parenttype": "Admission Detail",
        "medicine_code": ["is", "set"],
        "sales_order": ["is", "not set"],
    }
    if consumption_date:
        filters["date"] = getdate(consumption_date)
    return filters


def _unbilled_medicine_given_dates(admission_detail_name):
    """Distinct dates that still have unbilled Medicine Given rows."""
    rows = frappe.get_all(
        "Medicine Given",
        filters=_unbilled_medicine_given_filters(admission_detail_name),
        fields=["date"],
        distinct=True,
        order_by="date desc",
        limit_page_length=10,
    )
    return [str(getdate(r.date)) for r in rows if r.get("date")]


def _link_medicine_given_to_billing(row_names, sales_order, delivery_note):
    """Stamp Sales Order / Delivery Note on Medicine Given child rows."""
    if not row_names:
        return 0
    values = {}
    if sales_order:
        values["sales_order"] = sales_order
    if delivery_note:
        values["delivery_note"] = delivery_note
    if not values:
        return 0
    for row_name in row_names:
        frappe.db.set_value("Medicine Given", row_name, values, update_modified=True)
    return len(row_names)


def _set_delivery_note_allow_zero_valuation_rate(dn):
    """Allow DN stock posting when Item/batch valuation rate is 0 (common for imported stock)."""
    dn_item_meta = frappe.get_meta("Delivery Note Item")
    if not dn_item_meta.has_field("allow_zero_valuation_rate"):
        return
    for row in dn.get("items") or []:
        row.allow_zero_valuation_rate = 1


def _validate_delivery_note_batch_stock(dn):
    """Fail early with item/batch detail when batch qty is insufficient at the DN warehouse.

    Compares in stock UOM: ``get_batch_qty`` returns stock-UOM balances, while DN row
    ``qty`` may be in a sales/dispense UOM (e.g. UNIT while stock is PACK).
    """
    from erpnext.stock.doctype.batch.batch import get_batch_qty
    from erpnext.stock.get_item_details import get_conversion_factor

    shortages = []
    for idx, row in enumerate(dn.get("items") or [], start=1):
        item_code = (getattr(row, "item_code", None) or "").strip()
        batch_no = (getattr(row, "batch_no", None) or "").strip()
        warehouse = (getattr(row, "warehouse", None) or getattr(dn, "set_warehouse", None) or "").strip()
        qty = flt(getattr(row, "qty", 0))
        if not item_code or not batch_no or not warehouse or qty <= 0:
            continue

        stock_qty = flt(getattr(row, "stock_qty", None) or 0)
        if stock_qty <= 0:
            conversion_factor = flt(getattr(row, "conversion_factor", None) or 0)
            if conversion_factor <= 0:
                uom = (getattr(row, "uom", None) or "").strip()
                if uom:
                    conversion_factor = flt(get_conversion_factor(item_code, uom).get("conversion_factor")) or 1
                else:
                    conversion_factor = 1
            stock_qty = qty * conversion_factor

        available = flt(get_batch_qty(batch_no=batch_no, warehouse=warehouse) or 0)
        if available + 1e-9 < stock_qty:
            label = getattr(row, "item_name", None) or item_code
            stock_uom = (
                getattr(row, "stock_uom", None)
                or frappe.db.get_value("Item", item_code, "stock_uom")
                or ""
            )
            shortages.append(
                _("Row #{0}: {1} ({2}) — need {3:g} {4}, available {5:g} {4} in batch {6} at {7}").format(
                    idx,
                    label,
                    item_code,
                    stock_qty,
                    stock_uom,
                    available,
                    batch_no,
                    warehouse,
                )
            )
    if shortages:
        frappe.throw(
            _("Not enough batch stock for pharmacy give-out:<br>{0}").format("<br>".join(shortages)),
            title=_("Insufficient Stock"),
        )


def _create_delivery_note_for_sales_order(
	sales_order_name,
	patient,
	posting_date=None,
	billing_groups=None,
	warehouse=None,
	cost_center=None,
):
	"""Create and submit a Delivery Note from a submitted Sales Order to consume stock."""
	from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note

	dn = make_delivery_note(sales_order_name)
	if not dn or not dn.get("items"):
		frappe.throw(
			_("Could not create Delivery Note from Sales Order {0}. Ensure the order has deliverable stock items.").format(
				sales_order_name
			)
		)

	# Pharmacy give-out SO may also include non-stock service lines — only deliver medicines.
	if billing_groups:
		allowed_codes = {
			(g.get("medicine_code") or "").strip()
			for g in billing_groups
			if (g.get("medicine_code") or "").strip()
		}
		if allowed_codes:
			dn.set(
				"items",
				[row for row in (dn.get("items") or []) if (row.item_code or "") in allowed_codes],
			)
			if not dn.get("items"):
				frappe.throw(
					_("Could not create Delivery Note from Sales Order {0}. No deliverable medicine lines found.").format(
						sales_order_name
					)
				)

	if posting_date:
		dn.posting_date = getdate(posting_date)
		dn.set_posting_time = 0

	dn_meta = frappe.get_meta("Delivery Note")
	if patient and dn_meta.has_field("patient"):
		dn.patient = patient

	if cost_center and dn_meta.has_field("cost_center"):
		dn.cost_center = cost_center

	# Always pin warehouse so stock is reduced from the nurse mini-warehouse, not a blank/default location.
	if warehouse:
		if dn_meta.has_field("set_warehouse"):
			dn.set_warehouse = warehouse
		for row in dn.get("items") or []:
			row.warehouse = warehouse
			if cost_center and hasattr(row, "cost_center"):
				row.cost_center = cost_center

	missing_wh = [
		(getattr(row, "item_code", None) or _("Row {0}").format(idx))
		for idx, row in enumerate(dn.get("items") or [], start=1)
		if flt(getattr(row, "qty", 0)) > 0
		and cint(frappe.get_cached_value("Item", row.item_code, "is_stock_item"))
		and not (getattr(row, "warehouse", None) or "").strip()
	]
	if missing_wh:
		frappe.throw(
			_("Delivery Note warehouse is required to reduce stock for: {0}").format(
				", ".join(missing_wh)
			)
		)

	_apply_medicine_tracking_to_delivery_note(dn, billing_groups or [])
	_fill_missing_delivery_note_batch_serial(dn)
	_set_delivery_note_allow_zero_valuation_rate(dn)
	_validate_delivery_note_dispensing_lots(dn)
	_validate_delivery_note_batch_stock(dn)

	dn.insert(ignore_permissions=True)
	dn.submit()
	_process_delivery_note_dispensing_lots(dn)

	return dn


def _create_medicine_sales_order_for_admission(admission, consumption_date):
    """Create and submit a Sales Order + Delivery Note for unbilled Medicine Given.

    When ``consumption_date`` is set, only that day's rows are billed. When it is
    omitted, all unbilled rows for the admission are billed with today's date
    (mid-week discharge catch-up).
    """
    from healthcare.api.medicine_given import _get_or_create_admission_detail
    from healthcare.api.patient_medication_order import get_item_rate_for_uom, get_item_tax, get_tax_account
    from healthcare.api.sales_order_cost_center import apply_cost_center_to_sales_order
    from erpnext.stock.get_item_details import get_conversion_factor

    admission = (admission or "").strip()
    if not admission:
        frappe.throw(_("Admission is required"))

    if not frappe.db.exists("Inpatient Admission", admission):
        frappe.throw(_("Inpatient Admission {0} does not exist").format(admission))

    admission_doc = frappe.get_doc("Inpatient Admission", admission)
    cost_center = (getattr(admission_doc, "cost_center", None) or "").strip()
    if not cost_center:
        frappe.throw(
            _("Cost Center is not set on Inpatient Admission {0}. Please set it on the admission record.").format(
                admission
            )
        )

    company = admission_doc.company or frappe.defaults.get_user_default("Company")
    if not company:
        frappe.throw(_("Company is required on Inpatient Admission {0}").format(admission))

    patient = admission_doc.patient
    if not patient:
        frappe.throw(_("Patient is required on Inpatient Admission {0}").format(admission))

    customer = frappe.db.get_value("Patient", patient, "customer")
    if not customer:
        frappe.throw(
            _("Patient {0} has no Customer linked. Link a customer on the patient record first.").format(patient)
        )

    admission_detail = _get_or_create_admission_detail(admission)
    given_rows = frappe.get_all(
        "Medicine Given",
        filters=_unbilled_medicine_given_filters(admission_detail.name, consumption_date),
        fields=[
            "name",
            "medicine_code",
            "medicine_name",
            "qty",
            "unit",
            "batch_no",
            "lot_no",
            "dispensing_lot",
        ],
    )
    # Given Medicine used to default date via UTC (toISOString), so near midnight Bahrain
    # rows land on "yesterday" while Service Bill looks at local today — fall back one day.
    if consumption_date and not given_rows:
        other_dates = _unbilled_medicine_given_dates(admission_detail.name)
        if other_dates:
            requested = getdate(consumption_date)
            fallback = getdate(other_dates[0])
            if (requested - fallback).days == 1:
                consumption_date = fallback
                given_rows = frappe.get_all(
                    "Medicine Given",
                    filters=_unbilled_medicine_given_filters(admission_detail.name, consumption_date),
                    fields=[
                        "name",
                        "medicine_code",
                        "medicine_name",
                        "qty",
                        "unit",
                        "batch_no",
                        "lot_no",
                        "dispensing_lot",
                    ],
                )
    billing_groups = _group_medicine_given_for_billing(given_rows)
    if not billing_groups:
        if not consumption_date:
            frappe.throw(
                _("No unbilled medicine given records found for admission {0}. Rows may already be linked to a Sales Order.").format(
                    admission
                )
            )
        other_dates = _unbilled_medicine_given_dates(admission_detail.name)
        if other_dates:
            frappe.throw(
                _(
                    "No unbilled medicine given records for admission {0} on {1}. "
                    "Unbilled given medicine exists on: {2}. "
                    "Edit those rows to today's date, or create the service bill for that date."
                ).format(admission, getdate(consumption_date), ", ".join(other_dates))
            )
        frappe.throw(
            _("No unbilled medicine given records found for admission {0} on {1}. Rows may already be linked to a Sales Order.").format(
                admission, getdate(consumption_date)
            )
        )
    linked_row_names = []
    for group in billing_groups:
        linked_row_names.extend(group.get("row_names") or [])

    warehouse = get_warehouse_for_cost_center(cost_center)
    if not warehouse:
        frappe.throw(
            _("No warehouse configured for cost center {0} in Healthcare Settings. Configure Nurse Mini Warehouse before billing given medicine.").format(
                cost_center
            )
        )

    billing_date = getdate(consumption_date) if consumption_date else getdate()

    so = frappe.new_doc("Sales Order")
    so.company = company
    so.patient = patient
    so.customer = customer
    so.transaction_date = billing_date
    so.delivery_date = billing_date

    if hasattr(so, "custom_patient_name") and admission_doc.patient_name:
        so.custom_patient_name = admission_doc.patient_name
    if hasattr(so, "custom_patient"):
        so.custom_patient = patient

    so.custom_reference_type = "Inpatient Admission"
    so.custom_reference_name = admission
    # Admission Detail is the parent of Medicine Given (autoname = admission).
    # Do not use "Medicine Given" here — it is a child table, so a Dynamic Link
    # to that DocType cannot resolve admission_detail.name.
    so.custom_base_reference = "Admission Detail"
    so.custom_base_reference_name = admission_detail.name

    if warehouse and hasattr(so, "set_warehouse"):
        so.set_warehouse = warehouse

    so_item_meta = frappe.get_meta("Sales Order Item")
    tax_templates_added = set()
    for group in billing_groups:
        item_code = group["medicine_code"]
        stock_uom = frappe.db.get_value("Item", item_code, "stock_uom") or ""
        uom = (group.get("unit") or "").strip() or stock_uom
        conversion_factor = 1.0
        if uom and stock_uom and uom != stock_uom:
            conversion_factor = flt(get_conversion_factor(item_code, uom).get("conversion_factor")) or 1.0
        item_row = {
            "item_code": item_code,
            "qty": group["qty"],
            "uom": uom,
            "stock_uom": stock_uom or uom,
            "conversion_factor": conversion_factor,
            "description": group["medicine_name"],
        }
        rate = flt(get_item_rate_for_uom(item_code, uom))
        if rate:
            item_row["rate"] = rate
            item_row["price_list_rate"] = rate
        if warehouse:
            item_row["warehouse"] = warehouse
        if group.get("batch_no") and so_item_meta.has_field("batch_no"):
            item_row["batch_no"] = group["batch_no"]
        so.append("items", item_row)

        tax_info = get_item_tax(item_code, company)
        tax_template = tax_info.get("tax_template")
        if tax_template and tax_template not in tax_templates_added:
            tax_account = get_tax_account(tax_template)
            if tax_account:
                so.append(
                    "taxes",
                    {
                        "charge_type": "On Net Total",
                        "account_head": tax_account,
                        "description": f"Tax: {tax_template}",
                        "rate": tax_info.get("tax_rate", 0),
                        "included_in_print_rate": 0,
                        "included_in_paid_amount": 0,
                    },
                )
                tax_templates_added.add(tax_template)

    apply_cost_center_to_sales_order(so, cost_center)
    so.insert(ignore_permissions=True)
    so.submit()

    try:
        dn = _create_delivery_note_for_sales_order(
            so.name,
            patient,
            billing_date,
            billing_groups,
            warehouse=warehouse,
            cost_center=cost_center,
        )
    except Exception:
        # SO.submit() may already have committed; cancel orphan order so billing can be retried cleanly.
        try:
            so_doc = frappe.get_doc("Sales Order", so.name)
            if so_doc.docstatus == 1:
                so_doc.cancel()
        except Exception:
            frappe.log_error(
                title=f"Failed to cancel SO {so.name} after Delivery Note error",
                message=frappe.get_traceback(),
            )
        raise

    linked_count = _link_medicine_given_to_billing(linked_row_names, so.name, dn.name)

    return {
        "sales_order": so.name,
        "status": so.status,
        "delivery_note": dn.name,
        "delivery_note_status": dn.status,
        "cost_center": cost_center,
        "warehouse": warehouse,
        "admission": admission,
        "linked_rows": linked_count,
    }


def admission_has_unbilled_medicine_given(admission):
    """True when the admission has Medicine Given rows not yet linked to a Sales Order."""
    admission = (admission or "").strip()
    if not admission:
        return False
    admission_detail = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
    if not admission_detail:
        return False
    return bool(
        frappe.get_all(
            "Medicine Given",
            filters=_unbilled_medicine_given_filters(admission_detail),
            limit_page_length=1,
        )
    )


def create_pending_medicine_sales_orders_for_admission(admission):
    """Create Sales Order + Delivery Note for all unbilled Medicine Given on an admission.

    Used when discharge starts mid-week so remaining given medicine is charged immediately
    instead of waiting for the daily/weekly consumption scheduler.
    """
    admission = (admission or "").strip()
    if not admission or not admission_has_unbilled_medicine_given(admission):
        return None
    return _create_medicine_sales_order_for_admission(admission, None)


@frappe.whitelist()
def create_daily_medicine_sales_order(admission=None, cost_center=None, consumption_date=None):
    """Create and submit a Sales Order + Delivery Note for medicine given on an admission/date.

    The Delivery Note posts stock out of the Nurse Mini Warehouse for the admission cost center.
    Cost center is taken from the linked Inpatient Admission (via Admission Detail),
    not from the current user's permissions.
    """
    admission = (admission or "").strip() or None
    consumption_date = getdate(consumption_date or today())

    if admission:
        result = _create_medicine_sales_order_for_admission(admission, consumption_date)
        frappe.db.commit()
        return result

    cost_center = (cost_center or "").strip() or None
    if not cost_center:
        frappe.throw(_("Admission or Cost Center is required"))

    admissions = frappe.db.sql(
        """
        SELECT DISTINCT ad.admission
        FROM `tabMedicine Given` mg
        INNER JOIN `tabAdmission Detail` ad ON ad.name = mg.parent
        INNER JOIN `tabInpatient Admission` ia ON ia.name = ad.admission
        WHERE mg.date = %s
          AND ia.cost_center = %s
          AND mg.medicine_code IS NOT NULL
          AND (mg.sales_order IS NULL OR mg.sales_order = '')
        """,
        (consumption_date, cost_center),
        as_dict=True,
    )
    if not admissions:
        frappe.throw(
            _("No unbilled medicine given records found for cost center {0} on {1}").format(
                cost_center, consumption_date
            )
        )

    created = []
    for row in admissions:
        created.append(_create_medicine_sales_order_for_admission(row.admission, consumption_date))

    frappe.db.commit()
    first = created[0]
    return {
        "sales_order": first["sales_order"],
        "status": first["status"],
        "delivery_note": first.get("delivery_note"),
        "delivery_note_status": first.get("delivery_note_status"),
        "cost_center": cost_center,
        "created_count": len(created),
        "sales_orders": [c["sales_order"] for c in created],
        "delivery_notes": [c.get("delivery_note") for c in created if c.get("delivery_note")],
    }


@frappe.whitelist()
def create_daily_medicine_sales_orders():
    """
    Scheduled job to create daily sales orders for medicine consumption.
    Runs daily at midnight to create sales orders for the previous day's medicine consumption.
    """
    from frappe.utils import add_days, today

    yesterday = add_days(today(), -1)

    admissions_with_consumption = frappe.db.sql(
        """
        SELECT DISTINCT ad.admission, ia.cost_center
        FROM `tabMedicine Given` mg
        INNER JOIN `tabAdmission Detail` ad ON ad.name = mg.parent
        INNER JOIN `tabInpatient Admission` ia ON ia.name = ad.admission
        WHERE mg.date = %s
          AND ia.cost_center IS NOT NULL
          AND mg.medicine_code IS NOT NULL
          AND (mg.sales_order IS NULL OR mg.sales_order = '')
        """,
        (yesterday,),
        as_dict=True,
    )

    created_orders = []
    failed_orders = []

    for row in admissions_with_consumption:
        admission = row.admission
        try:
            result = _create_medicine_sales_order_for_admission(admission, yesterday)
            created_orders.append(result)
            frappe.logger().info(
                f"Created daily medicine sales order {result['sales_order']} for admission {admission}"
            )
        except Exception as e:
            failed_orders.append({"admission": admission, "error": str(e)})
            frappe.logger().error(
                f"Failed to create daily medicine sales order for admission {admission}: {str(e)}"
            )

    if created_orders:
        frappe.db.commit()

    if created_orders:
        frappe.logger().info(
            f"Daily medicine sales orders created: {len(created_orders)} orders"
        )

    if failed_orders:
        frappe.logger().error(f"Failed to create daily medicine sales orders for: {failed_orders}")

    return {
        "created": created_orders,
        "failed": failed_orders,
    }
    
@frappe.whitelist()
def get_all_cost_centers(warehouse_context=None):
    """Get cost centers for mini-warehouse inventory selectors."""
    ctx = normalize_mini_warehouse_context(warehouse_context)
    if ctx == "laboratory":
        settings = frappe.get_doc("Healthcare Settings")
        names = list(
            {
                row.cost_center
                for row in (settings.laboratory_mini_warehouse or [])
                if row.cost_center
            }
        )
        if not names:
            return []
        return frappe.get_all(
            "Cost Center",
            filters={"name": ["in", names], "is_group": 0},
            fields=["name", "cost_center_name as label"],
            order_by="cost_center_name asc",
        )

    cost_centers = frappe.get_all(
        "Cost Center",
        filters={"is_group": 0},
        fields=["name", "cost_center_name as label"],
        order_by="cost_center_name asc",
    )
    return cost_centers