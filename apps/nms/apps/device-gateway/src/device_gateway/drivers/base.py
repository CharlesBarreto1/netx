"""Interface comum de driver por vendor.

Cada vendor (Juniper, Mikrotik) implementa as operações que tocam equipamento.
As libs pesadas (PyEZ, ncclient, Netmiko) são importadas LAZY dentro de cada
driver (extra `devices`), então este módulo carrega mesmo sem o extra instalado.

Contrato de segurança (AGENTS.md §1–6): `get_config`/`run_command` são read-only;
`apply_config` é a ÚNICA operação de escrita e o worker só a despacha quando o job
chega com `accessMode='write'` + `approvedBy` (a trava vive no `safety.py`, não aqui).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class ChannelCheck:
    """Resultado de um canal de gerência (espelha o ChannelCheck do contrato Zod)."""

    reachable: bool
    detail: str
    # Falso quando o canal não existe no vendor (ex.: NETCONF no RouterOS). A UI
    # renderiza "N/A" em vez de vermelho de falha.
    applicable: bool = True

    def as_dict(self) -> dict[str, object]:
        return {"reachable": self.reachable, "detail": self.detail, "applicable": self.applicable}


@dataclass(frozen=True)
class ApplyResult:
    """Resultado de uma aplicação de config (plan→apply→verify→rollback)."""

    ok: bool
    detail: str
    diff: str = ""
    committed: bool = False
    rolled_back: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "detail": self.detail,
            "diff": self.diff,
            "committed": self.committed,
            "rolledBack": self.rolled_back,
        }


@runtime_checkable
class DeviceDriver(Protocol):
    """Operações por vendor. Implementações são síncronas (rodam em thread no worker)."""

    #: chave humana do vendor ("juniper", "mikrotik").
    vendor: str
    #: True se o vendor expõe um 2º canal de gerência além de SSH/SNMP (NETCONF no Junos).
    has_secondary: bool
    #: rótulo do 2º canal no resultado de conectividade ("netconf", "api"…).
    secondary_label: str

    def check_secondary(
        self,
        *,
        host: str,
        username: str,
        password: str,
        ssh_port: int = 22,
        netconf_port: int = 830,
        timeout: float = 10.0,
    ) -> ChannelCheck:
        """Checa o 2º canal de gerência. Vendors sem 2º canal devolvem applicable=False."""
        ...

    def get_config(self, *, host: str, username: str, password: str, port: int) -> str:
        """Puxa a config completa em texto diffável (read-only)."""
        ...

    def run_command(
        self, *, host: str, username: str, password: str, port: int, command: str
    ) -> str:
        """Executa um comando read-only e devolve a saída em texto."""
        ...

    def apply_config(
        self,
        *,
        host: str,
        username: str,
        password: str,
        port: int,
        config: str,
        confirm_minutes: int = 5,
        dry_run: bool = False,
    ) -> ApplyResult:
        """Aplica config com rede de segurança (Junos: commit confirmed; RouterOS: pre/post export).

        `dry_run=True` só calcula/valida o diff sem efetivar (plan).
        """
        ...

    def confirm_commit(
        self, *, host: str, username: str, password: str, port: int
    ) -> ApplyResult:
        """Confirma um apply pendente (trava o rollback automático)."""
        ...
