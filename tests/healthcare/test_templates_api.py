from healthcare.api import templates


def test_list_templates_returns_fixture_when_no_frappe():
    res = templates.list_radiology_procedure_templates()
    assert isinstance(res, list)
