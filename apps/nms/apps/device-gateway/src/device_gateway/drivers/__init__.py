"""Registry de drivers por vendor. `get_driver(vendor)` é o ponto de entrada."""

from __future__ import annotations

from .base import ApplyResult, ChannelCheck, DeviceDriver
from .cisco_iosxe import CiscoIosXeDriver
from .juniper import JuniperDriver
from .mikrotik import MikrotikDriver

_DRIVERS: dict[str, DeviceDriver] = {
    "juniper": JuniperDriver(),
    "mikrotik": MikrotikDriver(),
    "cisco_iosxe": CiscoIosXeDriver(),
}

# Default histórico do MVP: vendor ausente/desconhecido cai em Juniper (compat).
_DEFAULT_VENDOR = "juniper"


def get_driver(vendor: str | None) -> DeviceDriver:
    """Resolve o driver do vendor. Vendor vazio/desconhecido → Juniper (compat MVP)."""
    key = (vendor or "").strip().lower()
    return _DRIVERS.get(key, _DRIVERS[_DEFAULT_VENDOR])


def supported_vendors() -> list[str]:
    return sorted(_DRIVERS)


__all__ = [
    "ApplyResult",
    "ChannelCheck",
    "DeviceDriver",
    "get_driver",
    "supported_vendors",
]
