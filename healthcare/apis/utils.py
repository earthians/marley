import frappe
class APIError(Exception):
    def __init__(self, msg, exc_type=frappe.ValidationError):
        self.msg = str(msg)
        self.exc_type = exc_type

def handle_exception(msg, exc=None):
    if isinstance(msg, Exception) and exc is None:
        exc_type = type(msg)
        msg_str = str(msg)
    else:
        exc_type = exc or frappe.ValidationError
        msg_str = str(msg)
    
    raise APIError(msg_str, exc_type)

from functools import wraps
from frappe import _

def validate_api_payload(
    allowed_keys=["filters","fields","limit","start","order_by","data"],
    allowed_fields=None,
    allowed_filters=None,
    require_auth=True,
    max_limit=100
):
    field_map = {} # maps base field to aliased field string (e.g., 'order_group' -> 'order_group as Encounter')
    alias_map = {} # maps alias to base field (e.g., 'Encounter' -> 'order_group')
    base_allowed = []
    if allowed_fields:
        for f in allowed_fields:
            if " as " in f.lower():
                idx = f.lower().find(" as ")
                base = f[:idx].strip()
                alias = f[idx+4:].strip()
                field_map[base] = f
                alias_map[alias] = base
            else:
                base = f.strip()
                field_map[base] = f
            base_allowed.append(base)

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                # 1️⃣ Handle Authentication
                if require_auth and frappe.session.user == "Guest":
                    handle_exception(_("Authentication required"), frappe.PermissionError)

                # 3️⃣ Flattened Data Collection
                if allowed_fields:
                    extracted_data = {}
                    for key in list(kwargs.keys()):
                        if key in allowed_fields or key in base_allowed or key in alias_map:
                            val = kwargs.pop(key)
                            real_key = alias_map.get(key, key)
                            extracted_data[real_key] = val
                    
                    if extracted_data:
                        current_data = kwargs.get("data", {})
                        if isinstance(current_data, str):
                            try:
                                current_data = frappe.parse_json(current_data)
                            except Exception:
                                current_data = {}
                        
                        if not isinstance(current_data, dict):
                            current_data = {}
                        
                        current_data.update(extracted_data)
                        kwargs["data"] = current_data

                # 4️⃣ Validate known keys
                for key in list(kwargs.keys()):
                    if key in ("cmd", "run_as_guest", "_", "doctype"):
                        kwargs.pop(key, None)
                        continue
                    if key not in allowed_keys:
                        handle_exception(_("Invalid parameter: {0}").format(key))

                # 5️⃣ Validate fields
                fields = kwargs.get("fields")
                if fields:
                    if isinstance(fields, str):
                        try:
                            fields = frappe.parse_json(fields)
                        except Exception:
                            handle_exception(_("Invalid fields format, expected JSON array"))
                    if allowed_fields:
                        safe_fields = []
                        for f in fields:
                            if f in allowed_fields:
                                safe_fields.append(f)
                            elif f in base_allowed:
                                safe_fields.append(field_map.get(f, f))
                            elif f in alias_map:
                                base = alias_map[f]
                                safe_fields.append(field_map.get(base, f))
                        
                        if not safe_fields:
                            handle_exception(_("No valid fields requested"))
                        kwargs["fields"] = list(set(safe_fields))
                    else:
                        kwargs["fields"] = fields
                else:
                    kwargs["fields"] = allowed_fields

                # 6️⃣ Handle POST/Data payload
                data = kwargs.get("data")
                if data:
                    if isinstance(data, str):
                        try:
                            data = frappe.parse_json(data)
                        except Exception:
                            handle_exception(_("Invalid data format, expected JSON object"))
                    if allowed_fields:
                        for key in list(data.keys()):
                            if key not in allowed_fields and key not in base_allowed and key not in alias_map:
                                handle_exception(_("Invalid field in data: {0}").format(key))
                            
                            # Normalize key to base field name in data dict
                            if key in alias_map:
                                data[alias_map[key]] = data.pop(key)
                    
                    kwargs["data"] = data

                # 7️⃣ Validate Filters
                filters = kwargs.get("filters", {})
                if isinstance(filters, str):
                    try:
                        filters = frappe.parse_json(filters)
                    except Exception:
                        handle_exception(_("Invalid filters format, expected JSON object"))
                kwargs["filters"] = filters or {}

                safe_filters = []
                or_filters = []

                if allowed_filters:
                    # Handle date ranges
                    start_date = filters.get("start_date")
                    end_date = filters.get("end_date")
                    
                    date_field = next((f for f in ["encounter_date", "date", "posting_date", "transaction_date"] if f in allowed_filters), None)
                    
                    if date_field:
                        if start_date:
                            safe_filters.append([date_field, ">=", start_date])
                        if end_date:
                            safe_filters.append([date_field, "<=", end_date])

                    for key, value in filters.items():
                        if key in ["start_date", "end_date"]:
                            continue
                            
                        value = str(value).strip()[:50]  
                        real_key = alias_map.get(key, key)
                        if real_key in allowed_filters:
                            safe_filters.append([real_key, "like", f"%{value}%"])
                        elif key == "search" and allowed_fields:
                            or_filters = [[base, "like", f"%{value}%"] for base in base_allowed]
                        else:
                            handle_exception(_("Invalid filter key: {0}").format(key))

                kwargs["safe_filters"] = safe_filters
                kwargs["or_filters"] = or_filters or None

                # 8️⃣ Pagination
                kwargs["limit"] = min(int(kwargs.get("limit", 10)), max_limit)
                kwargs["start"] = max(int(kwargs.get("start", 0)), 0)

                # 9️⃣ Order by
                order_by = kwargs.get("order_by")
                if order_by:
                    field = order_by.split()[0]
                    real_field = alias_map.get(field, field)
                    if allowed_fields and real_field not in (allowed_fields + base_allowed + ["modified"]):
                        kwargs["order_by"] = "modified desc"
                else:
                    kwargs["order_by"] = "modified desc"

                return func(*args, **kwargs)

            except APIError as e:
                # 1️⃣ Clear any standard Frappe messages/flags
                frappe.clear_messages()
                frappe.local.response.pop("exc", None)
                frappe.local.response.pop("_server_messages", None)

                # 2️⃣ Determine HTTP status code
                status_code = 400
                if e.exc_type == frappe.PermissionError:
                    status_code = 403
                elif e.exc_type == frappe.ValidationError:
                    status_code = 400
                else:
                    status_code = 500

                # 3️⃣ Build strict, clean response
                frappe.local.response["http_status_code"] = status_code
                frappe.local.response["exception"] = f"{e.exc_type.__name__}: {e.msg}"
                frappe.local.response["exc_type"] = e.exc_type.__name__
                
                # 4️⃣ Return top-level message
                return f"Error: {e.msg}"

        return wrapper
    return decorator