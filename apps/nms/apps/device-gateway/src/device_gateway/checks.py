"""Checagens de conectividade multi-vendor: SSH, 2º canal (NETCONF no Junos) e SNMP.

SSH e SNMP são genéricos (valem para qualquer vendor). O 2º canal de gerência é
delegado ao driver do vendor (`drivers/`): NETCONF/830 no Juniper, não-aplicável no
Mikrotik (RouterOS não fala NETCONF). As libs de equipamento vêm do extra `devices`
e são importadas LAZY. Cada check é best-effort e nunca levanta para fora.
"""

from __future__ import annotations

import asyncio

from .drivers import ChannelCheck, get_driver


def _check_ssh(
    host: str, port: int, username: str, password: str, timeout: float = 8.0
) -> ChannelCheck:
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
        return ChannelCheck(True, "autenticado")
    except paramiko.AuthenticationException:
        return ChannelCheck(False, "SSH responde, mas autenticação falhou")
    except Exception as e:  # noqa: BLE001 — best-effort, reporta o motivo
        return ChannelCheck(False, f"{type(e).__name__}: {e}")
    finally:
        client.close()


async def _check_snmp(host: str, community: str, timeout: float = 4.0) -> ChannelCheck:  # noqa: ASYNC109 — timeout é repassado ao pysnmp
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
            return ChannelCheck(False, str(err_indication))
        if err_status:
            return ChannelCheck(False, err_status.prettyPrint())
        descr = str(var_binds[0][1]) if var_binds else ""
        return ChannelCheck(True, f"sysDescr: {descr[:120]}")
    except Exception as e:  # noqa: BLE001
        return ChannelCheck(False, f"{type(e).__name__}: {e}")


async def run_connectivity_checks(
    *,
    vendor: str | None,
    host: str,
    username: str,
    password: str | None,
    snmp_community: str | None,
    ssh_port: int = 22,
    netconf_port: int = 830,
) -> dict[str, dict[str, object]]:
    """Roda os três canais e devolve ChannelCheck por canal (chave `netconf` = 2º canal do vendor)."""
    driver = get_driver(vendor)

    if password:
        ssh = await asyncio.to_thread(_check_ssh, host, ssh_port, username, password)
        secondary = await asyncio.to_thread(
            driver.check_secondary,
            host=host,
            username=username,
            password=password,
            ssh_port=ssh_port,
            netconf_port=netconf_port,
        )
    else:
        ssh = ChannelCheck(False, "sem senha cadastrada")
        secondary = (
            ChannelCheck(False, "sem senha cadastrada")
            if driver.has_secondary
            else ChannelCheck(False, "RouterOS não usa NETCONF — gerência via SSH", applicable=False)
        )

    snmp = (
        await _check_snmp(host, snmp_community)
        if snmp_community
        else ChannelCheck(False, "sem community")
    )

    return {
        "ssh": ssh.as_dict(),
        "netconf": secondary.as_dict(),
        "snmp": snmp.as_dict(),
    }
