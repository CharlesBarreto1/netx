"""Checagens de conectividade contra um Juniper: SSH, NETCONF (830) e SNMP.

As libs de equipamento (paramiko/ncclient/pysnmp) vêm do extra `devices` e são importadas
LAZY (dentro das funções) para o módulo carregar mesmo sem o extra instalado. Cada check é
best-effort e devolve (reachable, detail) — nunca levanta para fora.
"""

from __future__ import annotations

import asyncio

Check = tuple[bool, str]


def _check_ssh(host: str, port: int, username: str, password: str, timeout: float = 8.0) -> Check:
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            host,
            port=port,
            username=username,
            password=password,
            timeout=timeout,
            allow_agent=False,
            look_for_keys=False,
        )
        return True, "autenticado"
    except paramiko.AuthenticationException:
        return False, "SSH responde, mas autenticação falhou"
    except Exception as e:  # noqa: BLE001 — best-effort, reporta o motivo
        return False, f"{type(e).__name__}: {e}"
    finally:
        client.close()


def _check_netconf(
    host: str, port: int, username: str, password: str, timeout: float = 10.0
) -> Check:
    from ncclient import manager

    try:
        with manager.connect(
            host=host,
            port=port,
            username=username,
            password=password,
            hostkey_verify=False,
            allow_agent=False,
            look_for_keys=False,
            device_params={"name": "junos"},
            timeout=timeout,
        ) as m:
            return bool(m.connected), "sessão NETCONF estabelecida"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


async def _check_snmp(host: str, community: str, timeout: float = 4.0) -> Check:  # noqa: ASYNC109 — timeout é repassado ao pysnmp, não implementado aqui
    from pysnmp.hlapi.asyncio import (
        CommunityData,
        ContextData,
        ObjectIdentity,
        ObjectType,
        SnmpEngine,
        UdpTransportTarget,
        get_cmd,
    )

    try:
        target = await UdpTransportTarget.create((host, 161), timeout=timeout, retries=1)
        err_indication, err_status, _err_index, var_binds = await get_cmd(
            SnmpEngine(),
            CommunityData(community, mpModel=1),  # mpModel=1 => SNMPv2c
            target,
            ContextData(),
            ObjectType(ObjectIdentity("1.3.6.1.2.1.1.1.0")),  # sysDescr.0
        )
        if err_indication:
            return False, str(err_indication)
        if err_status:
            return False, err_status.prettyPrint()
        descr = str(var_binds[0][1]) if var_binds else ""
        return True, f"sysDescr: {descr[:120]}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


async def run_connectivity_checks(
    *,
    host: str,
    username: str,
    password: str | None,
    snmp_community: str | None,
    ssh_port: int = 22,
    netconf_port: int = 830,
) -> dict[str, dict[str, object]]:
    """Roda os três canais (SSH/NETCONF em thread, SNMP async) e devolve ChannelCheck por canal."""
    if password:
        ssh = await asyncio.to_thread(_check_ssh, host, ssh_port, username, password)
        netconf = await asyncio.to_thread(_check_netconf, host, netconf_port, username, password)
    else:
        ssh = (False, "sem senha cadastrada")
        netconf = (False, "sem senha cadastrada")
    snmp = await _check_snmp(host, snmp_community) if snmp_community else (False, "sem community")

    return {
        "ssh": {"reachable": ssh[0], "detail": ssh[1]},
        "netconf": {"reachable": netconf[0], "detail": netconf[1]},
        "snmp": {"reachable": snmp[0], "detail": snmp[1]},
    }
