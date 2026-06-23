"""Execução de playbooks read-only via PyEZ (NETCONF).

No MVP só comandos `show ...` — a função recusa qualquer outra coisa (§1/§2: a ferramenta
não aplica config). PyEZ importado LAZY (extra `devices`).
"""

from __future__ import annotations


def run_show_command(
    *, host: str, username: str, password: str, port: int, command: str
) -> str:
    if not command.strip().lower().startswith("show "):
        raise ValueError(f"comando não permitido (somente show): {command!r}")

    from jnpr.junos import Device

    with Device(
        host=host, user=username, passwd=password, port=port, gather_facts=False
    ) as dev:
        # warning=False suprime o aviso de uso de cli(); saída em texto para exibição N3.
        return str(dev.cli(command, format="text", warning=False))
