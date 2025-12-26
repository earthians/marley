import json
from pathlib import Path

import pytest

from healthcare.doctype.radiology_procedure_template.radiology_procedure_template import RadiologyProcedureTemplate, HAS_FRAPPE


def test_to_dict():
    r = RadiologyProcedureTemplate(
        template="Chest CT",
        modality="CT",
        body_part="Chest",
        description="Chest CT protocol",
        steps=[{"title": "Prep"}],
    )
    d = r.to_dict()
    assert d["template"] == "Chest CT"
    assert d["modality"] == "CT"
    assert d["body_part"] == "Chest"
    assert isinstance(d["steps"], list)


def test_to_doc_no_frappe():
    if not HAS_FRAPPE:
        r = RadiologyProcedureTemplate(template="T")
        assert r.to_doc() is None
    else:
        pytest.skip("Frappe available; skipping no-frappe assertion")


def test_fixture_exists_and_valid():
    p = Path("healthcare/fixtures/radiology_procedure_template/sample_chest_ct.json")
    assert p.exists(), f"Fixture not found: {p}"
    data = json.loads(p.read_text())
    assert data.get("template") == "Chest CT"
    assert data.get("modality") == "CT"
