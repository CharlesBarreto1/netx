"""Driver Juniper (Junos) — PyEZ/NETCONF. Libs importadas LAZY (extra `devices`)."""

from __future__ import annotations

from .base import ApplyResult, ChannelCheck


class JuniperDriver:
    vendor = "juniper"
    has_secondary = True
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
        """Estabelece uma sessão NETCONF (830) — o canal de gerência estruturado do Junos."""
        from ncclient import manager

        try:
            with manager.connect(
                host=host,
                port=netconf_port,
                username=username,
                password=password,
                hostkey_verify=False,
                allow_agent=False,
                look_for_keys=False,
                device_params={"name": "junos"},
                timeout=timeout,
            ) as m:
                return ChannelCheck(bool(m.connected), "sessão NETCONF estabelecida")
        except Exception as e:  # noqa: BLE001 — best-effort, reporta o motivo
            return ChannelCheck(False, f"{type(e).__name__}: {e}")

    def get_config(self, *, host: str, username: str, password: str, port: int) -> str:
        """Config completa no formato `set` (diffável e legível). Read-only."""
        from jnpr.junos import Device

        with Device(
            host=host, user=username, passwd=password, port=port, gather_facts=False
        ) as dev:
            cfg = dev.rpc.get_config(options={"format": "set"})
            return (cfg.text or "").strip() + "\n"

    def run_command(
        self, *, host: str, username: str, password: str, port: int, command: str
    ) -> str:
        """Executa um `show ...` via PyEZ (NETCONF) e devolve texto. Defesa: só `show`."""
        if not command.strip().lower().startswith("show "):
            raise ValueError(f"comando Junos não permitido (somente show): {command!r}")

        from jnpr.junos import Device

        with Device(
            host=host, user=username, passwd=password, port=port, gather_facts=False
        ) as dev:
            return str(dev.cli(command, format="text", warning=False))

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
        """Carrega config (formato `set`), valida e dá `commit confirmed` (rollback automático).

        `dry_run=True`: faz load + commit_check + diff e descarta (candidate rollback) — é o
        "plan". Quando efetiva, usa `commit confirmed <confirm_minutes>`: se o operador não
        confirmar (segundo commit) dentro da janela, o Junos reverte sozinho (AGENTS.md §6).
        """
        from jnpr.junos import Device
        from jnpr.junos.utils.config import Config

        with Device(
            host=host, user=username, passwd=password, port=port, gather_facts=False
        ) as dev:
            cu = Config(dev)
            cu.lock()
            try:
                cu.load(config, format="set", merge=False)
                diff = cu.diff() or ""
                if not diff.strip():
                    cu.unlock()
                    return ApplyResult(ok=True, detail="sem mudança (config idêntica)", diff="")
                cu.commit_check()
                if dry_run:
                    cu.rollback()
                    cu.unlock()
                    return ApplyResult(
                        ok=True, detail="plan validado (commit_check OK)", diff=diff
                    )
                cu.commit(comment="netx-nms apply", confirm=confirm_minutes)
                cu.unlock()
                return ApplyResult(
                    ok=True,
                    detail=(
                        f"commit confirmed {confirm_minutes}min — confirme em até "
                        f"{confirm_minutes}min ou o Junos reverte"
                    ),
                    diff=diff,
                    committed=True,
                )
            except Exception:
                # Qualquer falha de load/check: descarta o candidate e solta o lock.
                try:
                    cu.rollback()
                    cu.unlock()
                except Exception:  # noqa: BLE001 — best-effort na limpeza
                    pass
                raise

    def confirm_commit(self, *, host: str, username: str, password: str, port: int) -> ApplyResult:
        """Segundo commit que confirma um `commit confirmed` pendente (trava o rollback)."""
        from jnpr.junos import Device
        from jnpr.junos.utils.config import Config

        with Device(
            host=host, user=username, passwd=password, port=port, gather_facts=False
        ) as dev:
            cu = Config(dev)
            cu.commit(comment="netx-nms confirm")
            return ApplyResult(ok=True, detail="commit confirmado", committed=True)
