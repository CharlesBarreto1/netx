"""Coleta da config do equipamento (formato `set`) para backup. PyEZ LAZY (extra `devices`)."""

from __future__ import annotations


def get_config_set(*, host: str, username: str, password: str, port: int) -> str:
    """Puxa a config completa no formato `set` (diffável e legível). Read-only."""
    from jnpr.junos import Device

    with Device(
        host=host, user=username, passwd=password, port=port, gather_facts=False
    ) as dev:
        cfg = dev.rpc.get_config(options={"format": "set"})
        return (cfg.text or "").strip() + "\n"
