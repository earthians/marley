
from __future__ import annotations
from typing import List, Dict
try:
    import frappe  # type: ignore
    HAS_FRAPPE = True
except Exception:
    frappe = None
    HAS_FRAPPE = False

from ._decorators import _whitelist
import json
from pathlib import Path


def list_radiology_procedure_templates(limit: int = 100) -> List[Dict]:
    if HAS_FRAPPE:
        return frappe.get_all("Radiology Procedure Template", fields=["name", "template", "modality", "body_part"], limit=limit)
    # Return sample list from fixtures if not running in bench
    p = Path("healthcare/fixtures/radiology_procedure_template/sample_chest_ct.json")
    if p.exists():
        data = json.loads(p.read_text())
        return [{"template": data.get("template"), "modality": data.get("modality"), "body_part": data.get("body_part")}]
    return []


@_whitelist
def list_radiology_procedure_templates_endpoint(limit: int = 100):
    return list_radiology_procedure_templates(limit=limit)

