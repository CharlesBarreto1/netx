"""Driver Cisco IOS-XE (ASR 920/903/1000, ISR, Catalyst) — Netmiko/SSH. Lib LAZY (extra `devices`).

O IOS-XE não tem candidate config como o Junos e não traz NETCONF ligado de fábrica: a
gerência é por SSH (`cisco_xe` do Netmiko). No `apply_config` usamos a rede de segurança
NATIVA do IOS — `configure terminal revert timer <N>`: o equipamento arma o rollback ANTES
de aceitar a primeira linha e, se ninguém mandar `configure confirm` dentro da janela, ele
restaura sozinho a config anterior. Mesma semântica do `commit confirmed` do Junos e sem o
reboot que o RouterOS precisa.

Isso depende do **config archive** habilitado no equipamento (`archive` + `path`). O driver
checa antes de aplicar e recusa se não estiver: melhor falhar fechado do que escrever numa
caixa sem rede de segurança (AGENTS.md §2, §6). Ver `docs/MULTIVENDOR.md`.
"""

from __future__ import annotations

import difflib
import re
from typing import TYPE_CHECKING

from .base import ApplyResult, ChannelCheck

if TYPE_CHECKING:
    from netmiko import BaseConnection

_NETMIKO_DEVICE_TYPE = "cisco_xe"

# Ruído do `show running-config`: cabeçalho e linhas que mudam sozinhas a cada coleta.
# Fora do diff, senão todo backup aparece como alteração.
_NOISE_RE = re.compile(
    r"^(Building configuration|Current configuration\s*:|! Last configuration change|"
    r"! NVRAM config last updated|ntp clock-period)"
)
# O `show archive` só imprime esta linha quando o archive tem `path` configurado.
_ARCHIVE_MARKER = "archive file will be named"
_MAX_DIFF_LINES = 400


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


def _strip_config_noise(out: str) -> str:
    """Tira cabeçalho e linhas voláteis do `show running-config` — diff estável entre coletas."""
    lines = [ln.rstrip() for ln in out.splitlines() if not _NOISE_RE.match(ln.strip())]
    return "\n".join(lines).strip() + "\n"


def _unified_diff(before: str, after: str) -> str:
    """Diff antes/depois da running-config (o IOS não devolve diff pronto como o Junos)."""
    lines = list(
        difflib.unified_diff(
            before.splitlines(),
            after.splitlines(),
            fromfile="antes",
            tofile="depois",
            lineterm="",
        )
    )
    if len(lines) > _MAX_DIFF_LINES:
        lines = lines[:_MAX_DIFF_LINES] + [f"... (diff truncado em {_MAX_DIFF_LINES} linhas)"]
    return "\n".join(lines)


def _assert_archive_enabled(conn: BaseConnection) -> None:
    """Sem config archive o IOS não tem para onde reverter — recusa antes de tocar a config."""
    out = str(conn.send_command("show archive", read_timeout=30))
    if _ARCHIVE_MARKER not in out.lower():
        raise RuntimeError(
            "config archive não habilitado no equipamento: sem ele o `configure terminal "
            "revert timer` não tem para onde voltar e o apply ficaria sem rollback. "
            "Configure no device: `archive` / `path flash:netx-archive` / `maximum 5` / "
            "`write-memory`."
        )


class CiscoIosXeDriver:
    vendor = "cisco_iosxe"
    # Gerência 100% por SSH. has_secondary=False é o que faz o worker usar a porta SSH (22)
    # em TODAS as operações — se fosse True ele mandaria 830 e o Netmiko não conectaria.
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
        """IOS-XE 16.x+ até fala NETCONF, mas o NMS gerencia por SSH — canal N/A, não é falha."""
        return ChannelCheck(
            reachable=False,
            detail="IOS-XE gerenciado por SSH — NETCONF não é usado pelo NMS",
            applicable=False,
        )

    def get_config(self, *, host: str, username: str, password: str, port: int) -> str:
        """`show running-config` sem o cabeçalho volátil (texto diffável). Read-only."""
        conn = _connect(host, username, password, port)
        try:
            out = conn.send_command("show running-config", read_timeout=120)
        finally:
            conn.disconnect()
        return _strip_config_noise(str(out))

    def run_command(
        self, *, host: str, username: str, password: str, port: int, command: str
    ) -> str:
        """Executa um `show ...` e devolve texto. Defesa em profundidade: só `show`.

        O comando vem do catálogo curado da API, mas o exec do IOS aceitaria `reload`/`copy`
        na mesma sessão — a trava fica aqui também.
        """
        if not command.strip().lower().startswith("show "):
            raise ValueError(f"comando IOS-XE não permitido (somente show): {command!r}")

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
        """Aplica com `configure terminal revert timer <N>` — rollback nativo do IOS.

        `dry_run=True`: NÃO toca o equipamento (não há candidate config no IOS-XE) — devolve os
        comandos como "plan". Quando efetiva: exige o config archive, captura a running-config,
        entra em config mode JÁ com o revert armado, aplica e captura de novo (o diff sai do
        antes/depois). `confirm_commit` manda `configure confirm`; sem isso o IOS reverte sozinho.
        """
        commands = [
            ln.rstrip()
            for ln in config.splitlines()
            if ln.strip() and not ln.lstrip().startswith("!")
        ]
        if not commands:
            return ApplyResult(ok=True, detail="nada a aplicar (config vazia)", diff="")

        if dry_run:
            return ApplyResult(
                ok=True,
                detail="plan (IOS-XE não tem candidate config; comandos a aplicar)",
                diff="\n".join(commands),
            )

        conn = _connect(host, username, password, port)
        try:
            _assert_archive_enabled(conn)
            before = _strip_config_noise(
                str(conn.send_command("show running-config", read_timeout=120))
            )
            # O revert é armado NA ENTRADA do config mode: se a sessão cair no meio da
            # aplicação, o equipamento já está protegido.
            conn.send_config_set(
                commands,
                config_mode_command=f"configure terminal revert timer {confirm_minutes}",
                read_timeout=90,
            )
            after = _strip_config_noise(
                str(conn.send_command("show running-config", read_timeout=120))
            )
        finally:
            conn.disconnect()

        diff = _unified_diff(before, after)
        if not diff.strip():
            # Config idêntica, mas o revert está armado — segue pendente de confirmação
            # (o `configure confirm` é o que desarma o timer).
            return ApplyResult(
                ok=True, detail="sem mudança (config idêntica)", diff="", committed=True
            )
        return ApplyResult(
            ok=True,
            detail=(
                f"aplicado com revert timer {confirm_minutes}min — confirme em até "
                f"{confirm_minutes}min ou o IOS restaura a config anterior"
            ),
            diff=diff,
            committed=True,
        )

    def confirm_commit(
        self, *, host: str, username: str, password: str, port: int
    ) -> ApplyResult:
        """`configure confirm` desarma o revert; `write memory` grava no startup-config.

        Sem o `write memory` a mudança viveria só na running-config e sumiria no próximo
        reload — no Junos e no RouterOS o commit já persiste, aqui é passo separado.
        """
        conn = _connect(host, username, password, port)
        try:
            conn.send_command("configure confirm", read_timeout=30)
            conn.send_command("write memory", read_timeout=60)
        finally:
            conn.disconnect()
        return ApplyResult(
            ok=True,
            detail="mudança confirmada (revert desarmado + gravada no startup-config)",
            committed=True,
        )
