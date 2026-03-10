import frappe
from .utils import validate_api_payload,handle_exception



@frappe.whitelist(allow_guest=True)
@validate_api_payload(
    allowed_fields=["name","patient_name","customer"],
    allowed_filters=["name","patient_name"],
    require_auth=False
)
def get_patient(filters=None, fields=None, limit=10, start=0, order_by=None, safe_filters=None, or_filters=None):
    return frappe.get_all(
        "Patient",
        filters=safe_filters,
        or_filters=or_filters,
        fields=fields,
        limit_page_length=limit,
        start=start,
        order_by=order_by,
        ignore_permissions=True
    )

@frappe.whitelist(allow_guest=True)
@validate_api_payload(
    allowed_fields = ["name","title","practitioner","appointment_type","creation"],
    allowed_filters = ["name","patient","patient_name","practitioner","practitioner_name"],
    require_auth = False
)
def get_patient_encounter(filters=None, fields=None, limit=10, start=0, order_by=None, safe_filters=None, or_filters=None):
    safe_filters.append(["docstatus","=",1])
    return frappe.get_all(
        "Patient Encounter",
        filters=safe_filters,
        or_filters=or_filters,
        fields=fields,
        limit_page_length=limit,
        start=start,
        order_by=order_by,
        ignore_permissions=True
    )

@frappe.whitelist(allow_guest=True)
@validate_api_payload(
    allowed_fields=["name","order_group","medication_item","dosage","period","quantity"],
    allowed_filters=["order_group","patient"],
    require_auth=False
)
def get_drug_prescription(filters=None, fields=None, limit=10, start=0, order_by=None, safe_filters=None, or_filters=None):
    try:
        final_filters = safe_filters or []

        patient_filters = [f for f in final_filters if f[0] == "patient"]
        if patient_filters:
            patient_name = patient_filters[0][2].replace("%","")
            encounters = frappe.get_all(
                "Patient Encounter",
                filters={"patient": ["like", f"%{patient_name}%"],"docstatus":"1"},
                fields=["name"],
                ignore_permissions=True
            )
            encounter_list = [e.name for e in encounters]
            if not encounter_list:
                return []
            final_filters = [f for f in final_filters if f[0] != "patient"]
            final_filters.append(["order_group", "in", encounter_list])

        return frappe.get_all(
            "Medication Request",
            filters=final_filters,
            or_filters=or_filters,
            fields=fields,
            limit_page_length=limit,
            start=start,
            order_by=order_by,
            ignore_permissions=True
        )
    except Exception as e:
       handle_exception(e)


@frappe.whitelist(allow_guest=True)
@validate_api_payload(
    allowed_fields=["service","rate","income_account","qty"],
    allowed_filters=["patient","encouner_name"],
    require_auth=False
)
def get_service_requests(filters=None, fields=None, limit=50, start=0, order_by=None, safe_filters=None, or_filters=None):
    try:
        result = []
        
        sr_filters = {"docstatus": "1"}
        if filters.get("patient"):
            sr_filters["patient"] = ["like", f"%{filters.get('patient')}%"]
        if filters.get("encouner_name"):
            sr_filters["order_group"] = ["like", f"%{filters.get('encouner_name')}%"]
            
        service_requests = frappe.get_all(
            "Service Request",
            filters=sr_filters,
            fields=["name","template_dt","template_dn","source_doc","order_group","quantity"],
            limit_page_length=limit,
            start=start,
            order_by=order_by,
            ignore_permissions=True
        )

        for sr in service_requests:
            if sr.get("template_dt") and sr.get("template_dn"):
                item = frappe.get_value(sr.get("template_dt"), {"name":sr.get("template_dn")}, ["*"],as_dict=True)
            obj = {
                "reference_type": sr.get("source_doc") if sr.get("source_doc")  else"Service Request",
                "reference_name": sr.get("order_group") if sr.get("order_group")  else sr.name,
                "service": item.get("item_code") or item.get("lab_test_name"),
                "qty": getattr(sr, "quantity"),
                "rate": item.get("rate")or item.get("lab_test_rate"),
                "serverice_type":sr.get("template_dt")
            }
            result.append(obj)

        return result

    except Exception as e:
        handle_exception(e)