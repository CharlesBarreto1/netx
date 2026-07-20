"""Driver Parks (Parks OS, switches PK900) — Netmiko/SSH. Lib importada LAZY (extra `devices`).

O Parks OS é um NOS de base Centec com CLI parecida com a da Cisco, mas com três diferenças
que quebram um driver escrito "no automático" — todas verificadas contra um PK900-48X6C real:

1. **O pager NÃO é `terminal length 0`, e sim `terminal page-break disable`.** Nenhum
   `device_type` do Netmiko manda esse comando. Sem ele o `show running-config` volta com
   ~25 linhas em vez de ~492: um backup TRUNCADO que parece íntegro. Por isso o pager é
   desligado em toda sessão, e o `get_config` ainda recusa saída suspeita de corte.
2. **Não existe `commit`/`rollback` e o equipamento não tem agendador**, então não dá para
   armar auto-revert no device (como se faz no RouterOS). A rede de segurança possível é
   outra: no Parks a config entra a quente mas só persiste no `write`. O `apply_config`
   NÃO grava — deixa a running divergente da startup, de modo que um reboot volta ao estado
   anterior — e `confirm_commit` é justamente o `write`. Sem confirmação, a mudança vive
   até o próximo boot. Isso está documentado em `docs/MULTIVENDOR.md`.
3. O host key SSH só é oferecido em `ssh-rsa`/`ssh-dss` (legado): o cliente OpenSSH moderno
   recusa a conexão, mas o Paramiko usado pelo Netmiko negocia normalmente.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .base import ApplyResult, ChannelCheck

if TYPE_CHECKING:
    from netmiko import BaseConnection

# `centec_os` é a base real do Parks OS (nomenclatura de porta e CLI batem).
_NETMIKO_DEVICE_TYPE = "centec_os"
_DISABLE_PAGER = "terminal page-break disable"
_BACKUP_CMD = "write backup-config"

# Cabeçalho volátil do `show running-config` — fora do diff, senão todo backup "muda".
_NOISE_RE = re.compile(r"^\s*(Being processed|System current configuration)")
# Se o pager escapar, a saída vem com isto no meio: sinal de config truncada.
_PAGER_MARK = "--More--"
# Uma running-config real tem dezenas de linhas; abaixo disso é corte, não config pequena.
_MIN_CONFIG_LINES = 20


def _connect(host: str, username: str, password: str, port: int) -> BaseConnection:
    from netmiko import ConnectHandler

    conn = ConnectHandler(
        device_type=_NETMIKO_DEVICE_TYPE,
        host=host,
        username=username,
        password=password,
        port=port,
        fast_cli=False,
        conn_timeout=15,
        auth_timeout=15,
        banner_timeout=15,
    )
    # Obrigatório: ver nota 1 do docstring do módulo.
    conn.send_command(_DISABLE_PAGER, read_timeout=30)
    return conn


def _strip_config_noise(out: str) -> str:
    """Remove o cabeçalho volátil do `show running-config` — diff estável entre coletas."""
    linhas = [ln.rstrip() for ln in out.splitlines() if not _NOISE_RE.match(ln)]
    return "\n".join(linhas).strip() + "\n"


class ParksDriver:
    vendor = "parks"
    # Gerência 100% por SSH: has_secondary=False é o que mantém o worker na porta 22.
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
        """Parks OS não fala NETCONF — canal marcado como não-aplicável (não é falha)."""
        return ChannelCheck(
            reachable=False,
            detail="Parks OS não usa NETCONF — gerência via SSH",
            applicable=False,
        )

    def get_config(self, *, host: str, username: str, password: str, port: int) -> str:
        """`show running-config` completo (texto diffável). Read-only.

        Falha alto se a saída parecer truncada: um backup pela metade é pior que nenhum,
        porque passa despercebido e só aparece na hora de restaurar.
        """
        conn = _connect(host, username, password, port)
        try:
            out = str(conn.send_command("show running-config", read_timeout=180))
        finally:
            conn.disconnect()

        config = _strip_config_noise(out)
        if _PAGER_MARK in out or len(config.splitlines()) < _MIN_CONFIG_LINES:
            raise RuntimeError(
                f"running-config veio truncada ({len(config.splitlines())} linhas): o pager "
                f"do equipamento não foi desligado. Backup abortado para não gravar config "
                f"pela metade."
            )
        return config

    def run_command(
        self, *, host: str, username: str, password: str, port: int, command: str
    ) -> str:
        """Executa um `show ...` e devolve texto. Defesa em profundidade: só `show`."""
        if not command.strip().lower().startswith("show "):
            raise ValueError(f"comando Parks não permitido (somente show): {command!r}")

        conn = _connect(host, username, password, port)
        try:
            return str(conn.send_command(command, read_timeout=90))
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
        """Aplica os comandos a quente, SEM persistir — o `write` fica para o confirm.

        `dry_run=True`: não toca o equipamento (não há candidate config) — devolve o plan.
        Quando efetiva: salva um ponto de restauração no próprio equipamento
        (`write backup-config`), aplica em modo de configuração e **não** grava a startup.
        Enquanto ninguém confirmar, a running está divergente da startup e um reboot desfaz
        a mudança. `confirm_minutes` é ignorado de propósito: o Parks não tem timer de revert,
        e fingir que tem seria pior que não ter.
        """
        commands = [
            ln.rstrip()
            for ln in config.splitlines()
            if ln.strip() and not ln.lstrip().startswith("!")
        ]
        if not commands:
            return ApplyResult(ok=True, detail="nada a aplicar (config vazia)", diff="")

        plan = "\n".join(commands)
        if dry_run:
            return ApplyResult(
                ok=True,
                detail="plan (Parks não tem candidate config; comandos a aplicar)",
                diff=plan,
            )

        conn = _connect(host, username, password, port)
        try:
            # Ponto de restauração no equipamento (recuperação manual via console).
            conn.send_command(_BACKUP_CMD, read_timeout=90)
            out = conn.send_config_set(commands, read_timeout=120)
        finally:
            conn.disconnect()

        return ApplyResult(
            ok=True,
            detail=(
                "aplicado a quente e NÃO gravado: a startup-config segue com a config "
                "anterior, então um reboot desfaz. Confirme para gravar (`write`). "
                "Atenção: o Parks não reverte sozinho — não há timer de rollback."
            ),
            diff=str(out),
            committed=True,
        )

    def confirm_commit(
        self, *, host: str, username: str, password: str, port: int
    ) -> ApplyResult:
        """`write` — só aqui a mudança passa a sobreviver a um reboot."""
        conn = _connect(host, username, password, port)
        try:
            out = str(conn.send_command("write", read_timeout=120))
        finally:
            conn.disconnect()
        return ApplyResult(
            ok=True,
            detail=f"mudança gravada na startup-config ({out.strip()[:80]})",
            committed=True,
        )
