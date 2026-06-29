"""Driver Mikrotik (RouterOS) — Netmiko/SSH. Lib importada LAZY (extra `devices`).

RouterOS não tem NETCONF nem commit-confirmed atômico como o Junos. A gerência é
por SSH (`mikrotik_routeros` do Netmiko). Para o `apply_config` emulamos a rede de
segurança do commit-confirmed com um backup binário + auto-revert agendado: se o
operador não confirmar dentro da janela, um scheduler do próprio RouterOS recarrega
o backup (reboot para o estado conhecido). É pesado, mas protege contra lockout.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .base import ApplyResult, ChannelCheck

if TYPE_CHECKING:
    from netmiko import BaseConnection

_NETMIKO_DEVICE_TYPE = "mikrotik_routeros"
# Primeira linha do `/export` é um comentário com data/hora → ruído em diff. Removida.
_EXPORT_DATE_RE = re.compile(r"^#\s*\d{4}-\d{2}-\d{2}\s")
_ROLLBACK_NAME = "netx-rollback"
_CONFIRM_SCHED = "netx-confirm-revert"


def _connect(host: str, username: str, password: str, port: int) -> BaseConnection:
    from netmiko import ConnectHandler

    return ConnectHandler(
        device_type=_NETMIKO_DEVICE_TYPE,
        host=host,
        username=username,
        password=password,
        port=port,
        fast_cli=False,
        conn_timeout=10,
        auth_timeout=10,
        banner_timeout=10,
    )


def _strip_export_noise(out: str) -> str:
    """Remove a linha de data do `/export` para o diff de backup ser estável."""
    lines = [ln for ln in out.splitlines() if not _EXPORT_DATE_RE.match(ln)]
    return "\n".join(lines).strip() + "\n"


class MikrotikDriver:
    vendor = "mikrotik"
    has_secondary = False
    secondary_label = "netconf"

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
        """RouterOS não fala NETCONF — canal marcado como não-aplicável (não é falha)."""
        return ChannelCheck(
            reachable=False,
            detail="RouterOS não usa NETCONF — gerência via SSH",
            applicable=False,
        )

    def get_config(self, *, host: str, username: str, password: str, port: int) -> str:
        """`/export` completo (texto, diffável). Read-only."""
        conn = _connect(host, username, password, port)
        try:
            out = conn.send_command("/export", read_timeout=60)
        finally:
            conn.disconnect()
        return _strip_export_noise(out)

    def run_command(
        self, *, host: str, username: str, password: str, port: int, command: str
    ) -> str:
        """Executa um comando read-only do RouterOS (ex.: `/interface print`) e devolve texto."""
        conn = _connect(host, username, password, port)
        try:
            return str(conn.send_command(command, read_timeout=60))
        finally:
            conn.disconnect()

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
        """Aplica comandos RouterOS com auto-revert agendado (emula commit confirmed).

        `dry_run=True`: NÃO toca o equipamento (RouterOS não tem candidate config) — devolve
        os comandos como "plan". Quando efetiva: salva backup binário `netx-rollback`, agenda
        um revert para daqui a `confirm_minutes`, aplica os comandos. `confirm_commit` cancela
        o scheduler; se ninguém confirmar, o RouterOS recarrega o backup (reboot → estado bom).
        """
        commands = [ln.strip() for ln in config.splitlines() if ln.strip() and not ln.startswith("#")]
        if not commands:
            return ApplyResult(ok=True, detail="nada a aplicar (config vazia)", diff="")

        plan = "\n".join(commands)
        if dry_run:
            return ApplyResult(
                ok=True,
                detail="plan (RouterOS não suporta dry-run nativo; comandos a aplicar)",
                diff=plan,
            )

        conn = _connect(host, username, password, port)
        try:
            # 1. Ponto de rollback (backup binário, instantâneo, sem reboot).
            conn.send_command(
                f"/system backup save name={_ROLLBACK_NAME} dont-encrypt=yes", read_timeout=60
            )
            # 2. Auto-revert: se ninguém confirmar, recarrega o backup (reboot → estado bom).
            conn.send_command(
                f'/system scheduler remove [find name="{_CONFIRM_SCHED}"]', read_timeout=30
            )
            conn.send_command(
                f'/system scheduler add name={_CONFIRM_SCHED} start-time=startup '
                f"interval={confirm_minutes}m "
                f'on-event="/system backup load name={_ROLLBACK_NAME}"',
                read_timeout=30,
            )
            # 3. Aplica os comandos.
            out = conn.send_config_set(commands, read_timeout=90)
        finally:
            conn.disconnect()

        return ApplyResult(
            ok=True,
            detail=(
                f"aplicado — auto-revert em {confirm_minutes}min se não confirmar "
                f"(backup {_ROLLBACK_NAME})"
            ),
            diff=str(out),
            committed=True,
        )

    def confirm_commit(self, *, host: str, username: str, password: str, port: int) -> ApplyResult:
        """Cancela o scheduler de auto-revert — torna a mudança permanente."""
        conn = _connect(host, username, password, port)
        try:
            conn.send_command(
                f'/system scheduler remove [find name="{_CONFIRM_SCHED}"]', read_timeout=30
            )
        finally:
            conn.disconnect()
        return ApplyResult(ok=True, detail="mudança confirmada (auto-revert cancelado)", committed=True)
