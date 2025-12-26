import pytest

from healthcare.api.imaging_orders import create_imaging_order


def test_create_imaging_order_requires_patient_and_procedures():
    with pytest.raises(ValueError):
        create_imaging_order({})


def test_create_imaging_order_happy_path():
    payload = {"patient_id": "P123", "procedures": [{"code": "XR-CHST"}]}
    result = create_imaging_order(payload)
    assert result.get("patient_id") == "P123"
    assert "id" in result
