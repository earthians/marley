from __future__ import annotations

try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False


class ImagingOrder:
    """Domain wrapper for Imaging Order.

    When running inside a Frappe bench this class will proxy operations to the
    `Imaging Order` DocType. When Frappe is not available it behaves as a plain
    Python object (useful for unit tests).
    """

    DOCTYPE = "Imaging Order"

    def __init__(self, patient_id: str, ordering_actor_id: str | None = None, procedures: list | None = None):
        self.patient_id = patient_id
        self.ordering_actor_id = ordering_actor_id
        self.procedures = procedures or []

    def to_dict(self) -> dict:
        return {
            "patient_id": self.patient_id,
            "ordering_actor_id": self.ordering_actor_id,
            "procedures": self.procedures,
        }

    def save(self) -> str | None:
        """Persist the ImagingOrder to Frappe if available. Returns the doc name/ID.

        Falls back to None when Frappe is not available.
        """
        if not HAS_FRAPPE:
            return None

        doc = frappe.get_doc({
            "doctype": self.DOCTYPE,
            "patient_id": self.patient_id,
            "ordering_actor_id": self.ordering_actor_id,
            "created_at": frappe.utils.now(),
        })

        # Attach procedures as child table entries if provided
        if self.procedures:
            for proc in self.procedures:
                doc.append("procedures", {
                    "doctype": "Radiology Procedure",
                    "code": proc.get("code"),
                    "description": proc.get("description"),
                })

        doc.insert()
        return doc.name

    @classmethod
    def get(cls, name: str) -> "ImagingOrder" | None:
        if not HAS_FRAPPE:
            return None
        d = frappe.get_doc(cls.DOCTYPE, name)
        procedures = []
        for r in getattr(d, "procedures", []):
            procedures.append({"code": r.get("code"), "description": r.get("description")})
        return ImagingOrder(patient_id=d.patient_id, ordering_actor_id=getattr(d, "ordering_actor_id", None), procedures=procedures)
