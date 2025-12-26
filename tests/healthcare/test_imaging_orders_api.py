import pytest

from healthcare.api import imaging_orders


def test_create_imaging_order_invalid():
    with pytest.raises(ValueError):
        imaging_orders.create_imaging_order({})


def test_list_imaging_orders_returns_list():
    res = imaging_orders.list_imaging_orders()
    assert isinstance(res, list)
