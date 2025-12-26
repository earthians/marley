"""API handlers for Imaging Orders (minimal stubs).

These are lightweight functions to be wired into the application's routing.
Expand to use the project's request/response framework and persistence layer.
"""
from __future__ import annotations
from typing import Dict, List, Any
from healthcare.doctype.imaging_order.imaging_order import ImagingOrder
from ._decorators import _whitelist
import json

try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False


def create_imaging_order(payload: Dict) -> Dict:
    # Minimal validation
    patient_id = payload.get("patient_id")
    procedures = payload.get("procedures", [])
    if not patient_id or not procedures:
        raise ValueError("patient_id and procedures are required")

    order = ImagingOrder(patient_id=patient_id, ordering_actor_id=payload.get("ordering_actor_id"), procedures=procedures)
    # Attempt to persist via Frappe when available
    if HAS_FRAPPE:
        doc = order.to_doc()
        if doc:
            doc.insert()
            doc.reload()
            return {"id": doc.name, "created_at": getattr(doc, "creation", None), **order.to_dict()}

    # Fallback response for non-Frappe environment
    return {"id": "local-temp", "created_at": None, **order.to_dict()}


def get_imaging_order(order_id: str) -> Dict:
    if HAS_FRAPPE:
        d = frappe.get_doc("Imaging Order", order_id)
        procedures = []
        for r in getattr(d, "procedures", []):
            procedures.append({"code": r.get("code"), "description": r.get("description")})
        return {"id": d.name, "patient_id": d.patient_id, "procedures": procedures}

    return {"id": order_id}


def list_imaging_orders(limit: int = 50) -> List[Dict[str, Any]]:
    if HAS_FRAPPE:
        rows = frappe.get_all("Imaging Order", fields=["name", "patient_id", "order_datetime", "status"], limit=limit)
        return [r for r in rows]
    # Non-frappe stub
    return []


@_whitelist
def create_imaging_order_endpoint(payload: str | Dict) -> Dict:
    """Endpoint wrapper that accepts JSON string or dict from a whitelisted call."""
    if isinstance(payload, str):
        payload = json.loads(payload)
    return create_imaging_order(payload)


@_whitelist
def get_imaging_order_endpoint(order_id: str) -> Dict:
    return get_imaging_order(order_id)


@_whitelist
def list_imaging_orders_endpoint(limit: int = 50) -> List[Dict[str, Any]]:
    return list_imaging_orders(limit=limit)

