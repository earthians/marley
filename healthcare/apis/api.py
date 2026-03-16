import frappe
from .utils import validate_api_payload,handle_exception
from healthcare.healthcare.doctype.lab_test.lab_test import get_lab_test_count_for_doc,create_lab_test
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_income_account

@frappe.whitelist()
@validate_api_payload(
    allowed_fields=["name", "patient_name","phone"],
    allowed_filters=["name", "patient_name", "uid", "phone"],
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

@frappe.whitelist()
@validate_api_payload(
    allowed_fields=["name", "title", "patient", "patient_name", "practitioner", "practitioner_name","encounter_date"],
    allowed_filters=["name", "patient", "patient_name", "practitioner", "practitioner_name","encounter_date"],
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

@frappe.whitelist()
@validate_api_payload(
    allowed_fields=["name","order_group as Encounter","medication_item","dosage","period","quantity","practitioner"],
    allowed_filters=["order_group","patient"],
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

        medication_requests = frappe.get_all(
            "Medication Request",
            filters=final_filters,
            or_filters=or_filters,
            fields=fields,
            limit_page_length=limit,
            start=start,
            order_by=order_by,
            ignore_permissions=True
        )
        result = []
        for medication_request in medication_requests:
            # Dynamically fetch item details if medication_item is present
            item_code = medication_request.get("medication_item")
            if item_code:
                medication_request["item_name"] = frappe.get_value("Item", item_code, "item_name")
                medication_request["rate"] = frappe.get_value("Item Price", {"item_code": item_code}, "price_list_rate")
                medication_request["reference_type"] = "Patient Encounter" if medication_request.get("Encounter") else "Medication Request"
                medication_request["reference_name"] = medication_request.get("order_group") or medication_request.get("name")
                medication_request["practitioner"] = medication_request.get("practitioner") 
            result.append(medication_request)
        return result
            
    except Exception as e:
       handle_exception(e)


@frappe.whitelist()
@validate_api_payload(
    allowed_fields=["service","rate","income_account","qty","name","order_date","practitioner"],
    allowed_filters=["patient","encouner_name","order_date"],
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
            fields=["name","template_dt","template_dn","source_doc","order_group","quantity","practitioner","practitioner_name","order_date"],
            limit_page_length=limit,
            start=start,
            order_by=order_by,
            ignore_permissions=True
        )

        for sr in service_requests:
            if sr.get("template_dt") and sr.get("template_dn"):
                item = frappe.get_value(sr.get("template_dt"), {"name":sr.get("template_dn")}, ["*"],as_dict=True)
            obj = {
                "name":sr.get("name"),
                "reference_type": sr.get("source_doc") if sr.get("source_doc")  else"Service Request",
                "reference_name": sr.get("order_group") if sr.get("order_group")  else sr.name,
                "service": item.get("item_code") or item.get("lab_test_name"),
                "item_name":item.get("item_name") or item.get("lab_test_name"),
                "qty": getattr(sr, "quantity"),
                "rate": item.get("rate")or item.get("lab_test_rate"),
                "serverice_type":sr.get("template_dt"),
                "order_date":sr.get("order_date"),
                "practitioner":sr.get("practitioner"),
                "income_account": get_income_account(sr.get("practitioner"), sr.get("company"))
            }
            result.append(obj)

        return result

    except Exception as e:
        handle_exception(e)


@frappe.whitelist()
def get_lab_test_result(doctype,docname):
    return get_lab_test_count_for_doc(doctype,docname)


@frappe.whitelist()
def create_lab_test(doctype,docname,create_bundle=False):
    return create_lab_test_logic(doctype,docname,create_bundle)

@frappe.whitelist()
@validate_api_payload(
    allowed_fields=["first_name", "middle_name", "last_name", "sex", "blood_group", "dob", "phone"],
)
def create_patient(data=None, **kwargs):
    try:
        payload = data or kwargs.get("data")
        if not payload:
            frappe.throw(_("Missing patient data"))

        doc = frappe.new_doc("Patient")
        doc.update(payload)
        doc.insert(ignore_permissions=True)
        return doc.name
    except Exception as e:
        handle_exception(e)

@frappe.whitelist()
@validate_api_payload(
    allowed_fields=["name", "patient_name"],
    allowed_filters=["name", "patient_name"],
)
def get_patient_by_name(filters=None, fields=None, limit=10, start=0, order_by=None, safe_filters=None, or_filters=None):
    try:
        return frappe.get_all(
            "Sales Invoice",
            filters=safe_filters,
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
    allowed_fields=["name", "practitioner_name"],
    allowed_filters=["name", "practitioner_name"],
    require_auth=False
)
def get_practitioner_by_name(filters=None, fields=None, limit=10, start=0, order_by=None, safe_filters=None, or_filters=None):
    try:
        return frappe.get_all(
            "Healthcare Practitioner",
            filters=safe_filters,
            or_filters=or_filters,
            fields=fields,
            limit_page_length=limit,
            start=start,
            order_by=order_by,
            ignore_permissions=True
        )
    except Exception as e:
        handle_exception(e)


    