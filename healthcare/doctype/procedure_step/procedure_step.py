from __future__ import annotations
from datetime import datetime

try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False


class ProcedureStep:
    VALID_STATUSES = {"pending", "scheduled", "in-progress", "performed", "cancelled"}

    DOCTYPE = "Procedure Step"

    def __init__(self, title: str, description: str | None = None):
        self.title = title
        self.description = description
        self.scheduled_datetime = None
        self.assigned_resource_id = None
        self.status = "pending"
        self.started_at = None
        self.completed_at = None
        self.audit_history = []

    def set_status(self, new_status: str, actor_id: str | None = None, note: str | None = None):
        if new_status not in self.VALID_STATUSES:
            raise ValueError("invalid status")
        prev = self.status
        self.status = new_status
        ts = datetime.utcnow().isoformat() + "Z"
        entry = {"actor_id": actor_id, "timestamp": ts, "from": prev, "to": new_status, "note": note}
        self.audit_history.append(entry)
        if new_status == "in-progress":
            self.started_at = ts
        if new_status == "performed":
            self.completed_at = ts

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "description": self.description,
            "scheduled_datetime": self.scheduled_datetime,
            "assigned_resource_id": self.assigned_resource_id,
            "status": self.status,
            "audit_history": self.audit_history,
        }

    def save(self) -> str | None:
        """Persist the ProcedureStep as a child or standalone DocType when running under Frappe.

        Returns the created doc name when persisted, otherwise None.
        """
        if not HAS_FRAPPE:
            return None

        # Create or append as a standalone doctype instance. For simplicity we insert a new
        # doc representing the step; in production this would usually be a child table entry.
        doc = frappe.get_doc({
            "doctype": self.DOCTYPE,
            "title": self.title,
            "description": self.description,
            "scheduled_datetime": self.scheduled_datetime,
            "assigned_resource_id": self.assigned_resource_id,
            "status": self.status,
        })
        doc.insert()
        # Persist audit history as child table entries if present
        if self.audit_history:
            for entry in self.audit_history:
                doc.append("audit_history", {
                    "actor_id": entry.get("actor_id"),
                    "timestamp": entry.get("timestamp"),
                    "from_status": entry.get("from"),
                    "to_status": entry.get("to"),
                    "note": entry.get("note"),
                })
            doc.save()
        return doc.name

    @classmethod
    def get(cls, name: str) -> "ProcedureStep" | None:
        if not HAS_FRAPPE:
            return None
        d = frappe.get_doc(cls.DOCTYPE, name)
        step = ProcedureStep(title=d.title, description=getattr(d, "description", None))
        step.scheduled_datetime = getattr(d, "scheduled_datetime", None)
        step.assigned_resource_id = getattr(d, "assigned_resource_id", None)
        step.status = getattr(d, "status", "pending")
        # Reconstruct audit history if present
        if hasattr(d, "audit_history"):
            for a in d.audit_history:
                step.audit_history.append({
                    "actor_id": a.get("actor_id"),
                    "timestamp": a.get("timestamp"),
                    "from": a.get("from_status"),
                    "to": a.get("to_status"),
                    "note": a.get("note"),
                })
        return step
