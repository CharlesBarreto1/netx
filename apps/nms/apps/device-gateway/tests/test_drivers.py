"""Testes do registry de drivers e da lógica vendor que não toca equipamento."""

import pytest

from device_gateway.drivers import get_driver, supported_vendors
from device_gateway.drivers.base import ApplyResult, ChannelCheck
from device_gateway.drivers.cisco_iosxe import _strip_config_noise, _unified_diff
from device_gateway.drivers.mikrotik import _strip_export_noise
from device_gateway.drivers.parks import _strip_config_noise as _strip_parks_noise


def test_registry_resolves_known_vendors():
    assert get_driver("juniper").vendor == "juniper"
    assert get_driver("mikrotik").vendor == "mikrotik"
    assert get_driver("MikroTik").vendor == "mikrotik"  # case-insensitive
    assert get_driver("cisco_iosxe").vendor == "cisco_iosxe"
    assert get_driver("Cisco_IOSXE").vendor == "cisco_iosxe"
    assert get_driver("parks").vendor == "parks"
    assert get_driver("PARKS").vendor == "parks"


def test_registry_defaults_to_juniper():
    # Vendor vazio/desconhecido cai em Juniper (compat MVP).
    assert get_driver(None).vendor == "juniper"
    assert get_driver("").vendor == "juniper"
    # `cisco` sozinho é ambíguo (IOS-XE vs IOS-XR): não resolve pro driver IOS-XE.
    assert get_driver("cisco").vendor == "juniper"


def test_supported_vendors():
    assert supported_vendors() == ["cisco_iosxe", "juniper", "mikrotik", "parks"]


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


def test_cisco_secondary_not_applicable():
    drv = get_driver("cisco_iosxe")
    assert drv.has_secondary is False  # garante porta SSH (22) no worker, não NETCONF/830
    check = drv.check_secondary(host="10.0.0.1", username="admin", password="x")
    assert check.applicable is False
    assert check.reachable is False
    assert "SSH" in check.detail


def test_cisco_run_command_rejects_non_show():
    # Defesa em profundidade: o exec do IOS aceitaria `reload`, o driver não.
    drv = get_driver("cisco_iosxe")
    with pytest.raises(ValueError, match="somente show"):
        drv.run_command(
            host="10.0.0.1", username="admin", password="x", port=22, command="reload"
        )


def test_cisco_apply_dry_run_does_not_touch_device():
    # dry_run não conecta (IOS-XE não tem candidate config) — devolve o plan.
    drv = get_driver("cisco_iosxe")
    result = drv.apply_config(
        host="10.0.0.1",
        username="admin",
        password="x",
        port=22,
        config="! comentário\ninterface Te0/0/1\n description uplink-core\n",
        dry_run=True,
    )
    assert result.ok is True
    assert result.committed is False
    assert "interface Te0/0/1" in result.diff
    assert "comentário" not in result.diff  # linhas `!` não são comando


def test_cisco_apply_empty_config_is_noop():
    drv = get_driver("cisco_iosxe")
    result = drv.apply_config(
        host="10.0.0.1", username="admin", password="x", port=22, config="!\n\n", dry_run=True
    )
    assert result.ok is True
    assert result.committed is False
    assert result.diff == ""


def test_cisco_strip_config_noise_removes_volatile_header():
    raw = (
        "Building configuration...\n"
        "\n"
        "Current configuration : 12345 bytes\n"
        "!\n"
        "! Last configuration change at 10:00:00 UTC Sun Jul 19 2026 by netx\n"
        "!\n"
        "hostname ASR920-BORDA\n"
        "ntp clock-period 17179860\n"
        "end\n"
    )
    out = _strip_config_noise(raw)
    assert "Building configuration" not in out
    assert "Current configuration" not in out
    assert "Last configuration change" not in out
    assert "ntp clock-period" not in out  # muda sozinho → sujaria todo diff de backup
    assert "hostname ASR920-BORDA" in out
    assert out.endswith("end\n")


def test_cisco_unified_diff_marca_linha_nova():
    diff = _unified_diff("hostname a\nend\n", "hostname a\nip domain name zux\nend\n")
    assert "+ip domain name zux" in diff
    assert _unified_diff("hostname a\n", "hostname a\n") == ""


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


def test_parks_secondary_not_applicable():
    drv = get_driver("parks")
    assert drv.has_secondary is False  # mantém a porta SSH (22) no worker
    check = drv.check_secondary(host="10.0.0.1", username="admin", password="x")
    assert check.applicable is False
    assert check.reachable is False


def test_parks_run_command_rejects_non_show():
    drv = get_driver("parks")
    with pytest.raises(ValueError, match="somente show"):
        drv.run_command(host="10.0.0.1", username="a", password="x", port=22, command="reboot")


def test_parks_apply_dry_run_does_not_touch_device():
    drv = get_driver("parks")
    r = drv.apply_config(
        host="10.0.0.1",
        username="a",
        password="x",
        port=22,
        config="! comentario\ninterface tengigabitethernet1/3/1\n description uplink\n",
        dry_run=True,
    )
    assert r.ok is True
    assert r.committed is False
    assert "interface tengigabitethernet1/3/1" in r.diff
    assert "comentario" not in r.diff


def test_parks_strip_config_noise():
    # O Parks prefixa a saída com um aviso de processamento + cabeçalho; ambos sujariam o diff.
    raw = (
        "\n Being processed.This may take a few minutes,please wait......\n"
        "\n System current configuration:\n"
        "!command in view_mode\n"
        "hostname SW_CORE-CPM1\n"
    )
    out = _strip_parks_noise(raw)
    assert "Being processed" not in out
    assert "System current configuration" not in out
    assert "hostname SW_CORE-CPM1" in out
