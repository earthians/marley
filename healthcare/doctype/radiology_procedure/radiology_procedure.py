from __future__ import annotations

try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False


class RadiologyProcedure:
    DOCTYPE = "Radiology Procedure"

    def __init__(self, code: str, description: str | None = None, priority: str = "routine", steps: list | None = None):
        self.code = code
        self.description = description
        self.priority = priority
        self.steps = steps or []

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "description": self.description,
            "priority": self.priority,
            "steps": self.steps,
        }

    def to_doc(self):
        if not HAS_FRAPPE:
            return None
        return frappe.get_doc({
            "doctype": self.DOCTYPE,
            "code": self.code,
            "description": self.description,
            "priority": self.priority,
        })
