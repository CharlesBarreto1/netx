"""Testes do registry de drivers e da lógica vendor que não toca equipamento."""

from device_gateway.drivers import get_driver, supported_vendors
from device_gateway.drivers.base import ApplyResult, ChannelCheck
from device_gateway.drivers.mikrotik import _strip_export_noise


def test_registry_resolves_known_vendors():
    assert get_driver("juniper").vendor == "juniper"
    assert get_driver("mikrotik").vendor == "mikrotik"
    assert get_driver("MikroTik").vendor == "mikrotik"  # case-insensitive


def test_registry_defaults_to_juniper():
    # Vendor vazio/desconhecido cai em Juniper (compat MVP).
    assert get_driver(None).vendor == "juniper"
    assert get_driver("").vendor == "juniper"
    assert get_driver("cisco").vendor == "juniper"


def test_supported_vendors():
    assert supported_vendors() == ["juniper", "mikrotik"]


def test_juniper_has_secondary_netconf():
    drv = get_driver("juniper")
    assert drv.has_secondary is True
    assert drv.secondary_label == "netconf"


def test_mikrotik_secondary_not_applicable():
    drv = get_driver("mikrotik")
    assert drv.has_secondary is False
    check = drv.check_secondary(host="10.0.0.1", username="admin", password="x")
    assert check.applicable is False
    assert check.reachable is False
    assert "NETCONF" in check.detail


def test_channel_check_as_dict():
    assert ChannelCheck(True, "ok").as_dict() == {
        "reachable": True,
        "detail": "ok",
        "applicable": True,
    }


def test_apply_result_as_dict():
    r = ApplyResult(ok=True, detail="feito", diff="set x", committed=True)
    d = r.as_dict()
    assert d["ok"] is True
    assert d["committed"] is True
    assert d["rolledBack"] is False


def test_strip_export_noise_removes_date_line():
    raw = (
        "# 2026-06-28 12:00:00 by RouterOS 7.15\n"
        "# software id = ABCD-1234\n"
        "/interface bridge\n"
        "add name=bridge1\n"
    )
    out = _strip_export_noise(raw)
    assert "by RouterOS" not in out
    assert "software id" in out  # estável: mantido
    assert "/interface bridge" in out


def test_mikrotik_apply_dry_run_does_not_touch_device():
    # dry_run não conecta (não há candidate config no RouterOS) — devolve o plan.
    drv = get_driver("mikrotik")
    result = drv.apply_config(
        host="10.0.0.1",
        username="admin",
        password="x",
        port=22,
        config="/ip address add address=10.0.0.2/24 interface=ether1\n",
        dry_run=True,
    )
    assert result.ok is True
    assert result.committed is False
    assert "ip address add" in result.diff
