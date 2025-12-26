from healthcare.api import procedure_steps


def test_update_procedure_step_status_accepts_valid():
    res = procedure_steps.update_procedure_step_status("local-step", "performed")
    assert res["status"] == "performed"


def test_update_procedure_step_status_invalid_raises():
    try:
        procedure_steps.update_procedure_step_status("x", "not-a-status")
        assert False, "expected ValueError"
    except ValueError:
        pass
