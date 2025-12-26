from __future__ import annotations
from typing import Dict, Any, List
try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False

from healthcare.doctype.radiology_procedure.radiology_procedure import RadiologyProcedure
from ._decorators import _whitelist
import json


def create_radiology_procedure(payload: Dict[str, Any]) -> Dict[str, Any]:
    code = payload.get("code")
    if not code:
        raise ValueError("code is required")

    rp = RadiologyProcedure(code=code, description=payload.get("description"), priority=payload.get("priority", "routine"), steps=payload.get("steps", []))
    if HAS_FRAPPE:
        doc = rp.to_doc()
        if doc:
            doc.insert()
            doc.reload()
            return {"id": doc.name, **rp.to_dict()}

    return {"id": "local-temp", **rp.to_dict()}


def list_radiology_procedures(limit: int = 50) -> List[Dict[str, Any]]:
    if HAS_FRAPPE:
        return frappe.get_all("Radiology Procedure", fields=["name", "code", "description", "priority"], limit=limit)
    return []


@_whitelist
def create_radiology_procedure_endpoint(payload: str | Dict) -> Dict[str, Any]:
    if isinstance(payload, str):
        payload = json.loads(payload)
    return create_radiology_procedure(payload)


@_whitelist
def list_radiology_procedures_endpoint(limit: int = 50) -> List[Dict[str, Any]]:
    return list_radiology_procedures(limit=limit)

