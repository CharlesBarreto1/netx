"""Coleta da config do equipamento para backup. Despacha por vendor (drivers/). Read-only.

Juniper: `get-config` formato `set`. Mikrotik: `/export`. O resultado (texto diffável) é
versionado pela API no git.
"""

from __future__ import annotations

from .drivers import get_driver


def get_config_set(
    *, host: str, username: str, password: str, port: int, vendor: str | None = None
) -> str:
    """Puxa a config completa em texto, pelo driver do vendor. Read-only."""
    return get_driver(vendor).get_config(host=host, username=username, password=password, port=port)
