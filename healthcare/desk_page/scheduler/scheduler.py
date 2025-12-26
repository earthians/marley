"""Minimal server-side desk page controller for Scheduler.

This file provides a whitelisted helper to fetch an Imaging Order and its Procedure Steps
for scheduling UI consumption. It is intentionally small so it can be used in both bench
and non-bench environments during development.
"""
try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False

from healthcare.api.procedure_steps import update_procedure_step_status
from . import __name__ as _mod

def _whitelist(f):
    try:
        return frappe.whitelist(f)
    except Exception:
        return f


@_whitelist
def get_order_for_scheduler(order_id: str):
    """Return order with procedures and steps for scheduler view."""
    if HAS_FRAPPE:
        d = frappe.get_doc("Imaging Order", order_id)
        out = {
            "id": d.name,
            "patient_id": getattr(d, "patient_id", None),
            "procedures": [],
        }
        for p in getattr(d, "procedures", []):
            proc = {"code": p.get("code"), "description": p.get("description"), "steps": []}
            for s in getattr(p, "steps", []):
                proc["steps"].append({"id": s.get("name"), "title": s.get("title"), "status": s.get("status"), "scheduled_datetime": s.get("scheduled_datetime")})
            out["procedures"].append(proc)
        return out

    # Non-frappe stub: return empty structure
    return {"id": order_id, "patient_id": None, "procedures": []}


@_whitelist
def schedule_step(step_id: str, scheduled_datetime: str):
    """Helper to schedule a step: sets scheduled_datetime and marks status 'scheduled'."""
    if HAS_FRAPPE:
        step = frappe.get_doc("Procedure Step", step_id)
        step.scheduled_datetime = scheduled_datetime
        step.status = "scheduled"
        step.save()
        return {"id": step.name, "status": step.status, "scheduled_datetime": step.scheduled_datetime}

    # Non-frappe fallback: call API logic
    return update_procedure_step_status(step_id, "scheduled")
