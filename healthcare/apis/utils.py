
import frappe
def frappe_response(http_status_code, message):
    frappe.local.response["http_status_code"] = http_status_code
    frappe.local.response["message"] = message
    return message



def handle_exception(e):
    frappe.clear_messages()
    return frappe_response(500, f"Error: {e}")


import frappe
from functools import wraps
from frappe import _

def validate_api_payload(
    allowed_keys=["filters","fields","limit","start","order_by"],
    allowed_fields=None,
    allowed_filters=None,
    require_auth=True,
    max_limit=10
):
    """
    Validates API payload:
    - Payload keys
    - Fields
    - Filters
    - Pagination
    - Order_by
    - Converts filters to safe LIKE filters
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):

            # 1️⃣ Authentication check
            if require_auth and frappe.session.user == "Guest":
                frappe.throw(_("Authentication required"), frappe.PermissionError)

            # 3️⃣ Validate allowed keys
            if allowed_keys:
                for key in list(kwargs.keys()):
                    if key in ("cmd", "run_as_guest", "_"):
                        kwargs.pop(key, None)
                        continue
                    if key not in allowed_keys:
                        frappe.throw(_("Invalid parameter: {0}").format(key))

            # 4️⃣ Validate fields
            fields = kwargs.get("fields")
            if fields:
                if isinstance(fields, str):
                    try:
                        fields = frappe.parse_json(fields)
                    except Exception:
                        frappe.throw(_("Invalid fields format, expected JSON array"))
                safe_fields = [f for f in fields if f in allowed_fields]
                if not safe_fields:
                    frappe.throw(_("No valid fields requested"))
                kwargs["fields"] = safe_fields
            else:
                kwargs["fields"] = allowed_fields

            # 5️⃣ Validate filters and convert to safe LIKE filters
            filters = kwargs.get("filters", {})
            if isinstance(filters, str):
                try:
                    filters = frappe.parse_json(filters)
                except Exception:
                    frappe.throw(_("Invalid filters format, expected JSON object"))
            kwargs["filters"] = filters or {}

            safe_filters = []
            or_filters = []

            if allowed_filters:
                for key, value in filters.items():
                    value = str(value).strip()[:50]  # optional max length
                    if key in allowed_filters:
                        safe_filters.append([key, "like", f"%{value}%"])
                    elif key == "search":
                        or_filters = [[f, "like", f"%{value}%"] for f in allowed_fields]
                    else:
                        frappe.throw(_("Invalid filter key: {0}").format(key))

            kwargs["safe_filters"] = safe_filters
            kwargs["or_filters"] = or_filters or None

            # 6️⃣ Pagination
            kwargs["limit"] = min(int(kwargs.get("limit", 10)), max_limit)
            kwargs["start"] = max(int(kwargs.get("start", 0)), 0)

            # 7️⃣ Order by
            order_by = kwargs.get("order_by")
            if order_by:
                field = order_by.split()[0]
                if field not in (allowed_fields + ["modified"]):
                    kwargs["order_by"] = "modified desc"
            else:
                kwargs["order_by"] = "modified desc"

            return func(*args, **kwargs)

        return wrapper
    return decorator


def frappe_response(http_status_code, message):
    frappe.local.response["http_status_code"] = http_status_code
    frappe.local.response["message"] = message
    return message



def handle_exception(e):
    frappe.clear_messages()
    return frappe_response(500, f"Error: {e}")