"""Execução de playbooks read-only, despachada por vendor (drivers/).

O comando vem do catálogo curado da API (playbooks.catalog.ts) — não é texto livre do
usuário. Juniper: `show ...` via PyEZ. Mikrotik: `/... print` via Netmiko. Cada driver
ainda aplica sua própria defesa read-only (ex.: o Junos recusa o que não começa com `show`).
"""

from __future__ import annotations

from .drivers import get_driver


def run_show_command(
    *,
    host: str,
    username: str,
    password: str,
    port: int,
    command: str,
    vendor: str | None = None,
) -> str:
    """Roda um comando read-only no device pelo driver do vendor e devolve a saída em texto."""
    return get_driver(vendor).run_command(
        host=host, username=username, password=password, port=port, command=command
    )
