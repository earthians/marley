import pytest

from healthcare.api import radiology_procedures


def test_create_radiology_procedure_invalid():
    with pytest.raises(ValueError):
        radiology_procedures.create_radiology_procedure({})


def test_list_radiology_procedures_returns_list():
    res = radiology_procedures.list_radiology_procedures()
    assert isinstance(res, list)
