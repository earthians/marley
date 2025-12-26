
from __future__ import annotations
from typing import Dict, Any
try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False

from ._decorators import _whitelist


def update_procedure_step_status(step_id: str, new_status: str) -> Dict[str, Any]:
    allowed = {"pending", "scheduled", "in-progress", "performed", "cancelled"}
    if new_status not in allowed:
        raise ValueError(f"invalid status: {new_status}")

    if HAS_FRAPPE:
        step = frappe.get_doc("Procedure Step", step_id)
        step.status = new_status
        step.save()
        return {"id": step.name, "status": step.status}

    return {"id": step_id, "status": new_status}


@_whitelist
def update_procedure_step_status_endpoint(step_id: str, new_status: str) -> Dict[str, Any]:
    return update_procedure_step_status(step_id, new_status)

"""API handlers for Procedure Steps (minimal stubs).

Provide endpoints to update status and scheduling fields. Replace TODOs with real
 persistence and framework integration.
"""
from __future__ import annotations
from healthcare.doctype.procedure_step.procedure_step import ProcedureStep

try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False

# In-memory store for local development/testing only (fallback)
_STORE: dict = {}

def update_step_status(step_id: str, payload: dict) -> dict:
    status = payload.get("status")
    notes = payload.get("notes")
    scheduled_datetime = payload.get("scheduled_datetime")
    actor_id = payload.get("actor_id")

    if HAS_FRAPPE:
        # Try to load an existing Procedure Step doc; if not found raise
        try:
            doc = frappe.get_doc("Procedure Step", step_id)
        except Exception:
            raise KeyError("step not found")

        if scheduled_datetime is not None:
            doc.scheduled_datetime = scheduled_datetime
            if doc.status == "pending":
                doc.status = "scheduled"
                # append audit entry if audit_history child table exists
                if hasattr(doc, "append"):
                    doc.append("audit_history", {
                        "actor_id": actor_id,
                        "timestamp": frappe.utils.now()
                    })

        if status:
            prev = getattr(doc, "status", "pending")
            doc.status = status
            if hasattr(doc, "append"):
                doc.append("audit_history", {
                    "actor_id": actor_id,
                    "timestamp": frappe.utils.now(),
                    "from_status": prev,
                    "to_status": status,
                    "note": notes,
                })

        doc.save()
        return {"id": doc.name, "status": doc.status}

    # Fallback: in-memory object
    step = _STORE.get(step_id)
    if not step:
        raise KeyError("step not found")

    if scheduled_datetime is not None:
        step.scheduled_datetime = scheduled_datetime
        if step.status == "pending":
            step.set_status("scheduled", actor_id=actor_id, note="scheduled")

    if status:
        step.set_status(status, actor_id=actor_id, note=notes)

    return step.to_dict()

    status = payload.get("status")
    notes = payload.get("notes")
    scheduled_datetime = payload.get("scheduled_datetime")

    if scheduled_datetime is not None:
        step.scheduled_datetime = scheduled_datetime
        if step.status == "pending":
            step.set_status("scheduled", actor_id=payload.get("actor_id"), note="scheduled")

    if status:
        step.set_status(status, actor_id=payload.get("actor_id"), note=notes)

    return step.to_dict()
