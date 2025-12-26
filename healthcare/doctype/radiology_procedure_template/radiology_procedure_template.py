from __future__ import annotations

try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False


class RadiologyProcedureTemplate:
    DOCTYPE = "Radiology Procedure Template"

    def __init__(self, template: str, modality: str | None = None, body_part: str | None = None, description: str | None = None, steps: list | None = None):
        self.template = template
        self.modality = modality
        self.body_part = body_part
        self.description = description
        self.steps = steps or []

    def to_dict(self) -> dict:
        return {
            "template": self.template,
            "modality": self.modality,
            "body_part": self.body_part,
            "description": self.description,
            "steps": self.steps,
        }

    def to_doc(self):
        if not HAS_FRAPPE:
            return None
        return frappe.get_doc({
            "doctype": self.DOCTYPE,
            "template": self.template,
            "modality": self.modality,
            "body_part": self.body_part,
            "description": self.description,
        })
