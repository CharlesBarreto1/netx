"""Worker que consome a fila de jobs e despacha por tipo.

Devolve resultado estruturado PELA FILA (AGENTS.md): a API persiste/encaminha o que volta.
A interação real com equipamento (PyEZ/NAPALM) entra atrás de `uv sync --extra devices`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from bullmq import Job, Worker

from .contracts import validate_job
from .crypto import CryptoService
from .safety import assert_job_is_safe
from .settings import Settings

log = structlog.get_logger()

QUEUE_DEVICE_JOBS = "device-jobs"  # espelha @netx-nms/shared QUEUE_DEVICE_JOBS


def _iso_z(dt: datetime) -> str:
    """ISO-8601 com sufixo Z (o Zod .datetime() do contrato não aceita offset +00:00)."""
    return dt.isoformat().replace("+00:00", "Z")


def _mgmt_port(vendor: str | None, params: dict[str, Any]) -> int:
    """Porta de gerência por vendor: NETCONF/830 no Junos, SSH/22 nos demais (Mikrotik)."""
    from .drivers import get_driver

    if get_driver(vendor).has_secondary:  # Juniper fala NETCONF
        return int(params.get("netconfPort", 830))
    return int(params.get("sshPort", 22))


async def process_job(
    job: Job, crypto: CryptoService | None, telegraf_dir: str
) -> dict[str, Any]:
    """Valida contrato + segurança, então despacha. Sempre devolve envelope estruturado."""
    started = datetime.now(UTC)
    data: dict[str, Any] = job.data
    log.info("job_received", kind=data.get("kind"), job_id=data.get("jobId"))

    validate_job(data)
    assert_job_is_safe(data)

    kind = data.get("kind")
    if kind == "connectivity-test":
        result_data = await _handle_connectivity_test(data, crypto)
    elif kind == "store-credential":
        result_data = _handle_store_credential(data, crypto)
    elif kind == "sync-snmp-config":
        result_data = _handle_sync_snmp_config(data, crypto, telegraf_dir)
    elif kind == "run-playbook":
        result_data = await _handle_run_playbook(data, crypto)
    elif kind == "backup-config":
        result_data = await _handle_backup_config(data, crypto)
    elif kind == "network-test":
        result_data = await _handle_network_test(data, crypto)
    elif kind == "apply-config":
        result_data = await _handle_apply_config(data, crypto)
    elif kind == "confirm-commit":
        result_data = await _handle_confirm_commit(data, crypto)
    else:
        raise ValueError(f"tipo de job desconhecido: {kind!r}")

    finished = datetime.now(UTC)
    return {
        "jobId": data["jobId"],
        "deviceId": data["deviceId"],
        "ok": True,
        "finishedAt": _iso_z(finished),
        "durationMs": (finished - started).total_seconds() * 1000,
        "data": result_data,
    }


async def _handle_connectivity_test(
    job: dict[str, Any], crypto: CryptoService | None
) -> dict[str, Any]:
    """Decifra as credenciais recebidas (ciphertext) e testa SSH, NETCONF e SNMP."""
    from .checks import run_connectivity_checks

    params: dict[str, Any] = job["params"]
    password = None
    snmp_community = None
    if crypto is not None:
        if params.get("passwordEnc"):
            password = crypto.decrypt(params["passwordEnc"])
        if params.get("snmpCommunityEnc"):
            snmp_community = crypto.decrypt(params["snmpCommunityEnc"])

    checks = await run_connectivity_checks(
        vendor=params.get("vendor"),
        host=params["mgmtIp"],
        username=params["username"],
        password=password,
        snmp_community=snmp_community,
        ssh_port=params.get("sshPort", 22),
        netconf_port=params.get("netconfPort", 830),
    )
    return {"kind": "connectivity-test", **checks}


def _handle_store_credential(job: dict[str, Any], crypto: CryptoService | None) -> dict[str, Any]:
    """Cifra os segredos recebidos e devolve só o ciphertext (a API persiste)."""
    if crypto is None:
        raise RuntimeError("MASTER_KEY não configurada: cofre indisponível neste gateway")
    params: dict[str, Any] = job["params"]
    out: dict[str, Any] = {"kind": "store-credential", "username": params["username"]}
    if params.get("password"):
        out["passwordEnc"] = crypto.encrypt(params["password"])
    if params.get("sshKey"):
        out["sshKeyEnc"] = crypto.encrypt(params["sshKey"])
    if params.get("snmpCommunity"):
        out["snmpCommunityEnc"] = crypto.encrypt(params["snmpCommunity"])
    return out


async def _handle_backup_config(
    job: dict[str, Any], crypto: CryptoService | None
) -> dict[str, Any]:
    """Puxa a config (set) do device para versionamento (a API commita no git)."""
    import asyncio

    from .backup import get_config_set

    params: dict[str, Any] = job["params"]
    if crypto is None or not params.get("passwordEnc"):
        raise RuntimeError("credencial indisponível para backup")
    password = crypto.decrypt(params["passwordEnc"])
    config = await asyncio.to_thread(
        get_config_set,
        host=params["mgmtIp"],
        username=params["username"],
        password=password,
        port=_mgmt_port(params.get("vendor"), params),
        vendor=params.get("vendor"),
    )
    return {"kind": "backup-config", "config": config}


async def _handle_run_playbook(
    job: dict[str, Any], crypto: CryptoService | None
) -> dict[str, Any]:
    """Executa um playbook read-only (comando show) via PyEZ e devolve a saída em texto."""
    import asyncio

    from .playbooks import run_show_command

    params: dict[str, Any] = job["params"]
    if crypto is None or not params.get("passwordEnc"):
        raise RuntimeError("credencial indisponível para executar o playbook")
    password = crypto.decrypt(params["passwordEnc"])

    output = await asyncio.to_thread(
        run_show_command,
        host=params["mgmtIp"],
        username=params["username"],
        password=password,
        port=_mgmt_port(params.get("vendor"), params),
        command=params["command"],
        vendor=params.get("vendor"),
    )
    return {"kind": "run-playbook", "playbookId": params["playbookId"], "output": output}


async def _handle_network_test(
    job: dict[str, Any], crypto: CryptoService | None
) -> dict[str, Any]:
    """Ping/traceroute do host (probe padrão) ou de um device via SSH. Read-only."""
    import asyncio

    from .network import run_network_test

    params: dict[str, Any] = job["params"]
    password = None
    if params.get("source") == "device" and crypto is not None and params.get("passwordEnc"):
        password = crypto.decrypt(params["passwordEnc"])

    return await asyncio.to_thread(
        run_network_test,
        test_type=params.get("testType", "ping"),
        target=params["target"],
        source=params.get("source", "host"),
        mgmt_ip=params.get("mgmtIp"),
        username=params.get("username"),
        password=password,
        ssh_port=params.get("sshPort", 22),
        vendor=params.get("vendor", ""),
    )


async def _handle_apply_config(
    job: dict[str, Any], crypto: CryptoService | None
) -> dict[str, Any]:
    """Aplica config no device (ESCRITA). O safety.py já garantiu accessMode=write + approvedBy.

    Despacha pelo driver do vendor com rede de segurança (Junos: commit confirmed; RouterOS:
    backup + auto-revert agendado). `dryRun=true` só valida/plana sem efetivar.
    """
    import asyncio

    from .drivers import get_driver

    params: dict[str, Any] = job["params"]
    if crypto is None or not params.get("passwordEnc"):
        raise RuntimeError("credencial indisponível para aplicar config")
    password = crypto.decrypt(params["passwordEnc"])
    driver = get_driver(params.get("vendor"))

    result = await asyncio.to_thread(
        driver.apply_config,
        host=params["mgmtIp"],
        username=params["username"],
        password=password,
        port=_mgmt_port(params.get("vendor"), params),
        config=params["config"],
        confirm_minutes=int(params.get("confirmMinutes", 5)),
        dry_run=bool(params.get("dryRun", False)),
    )
    return {"kind": "apply-config", "dryRun": bool(params.get("dryRun", False)), **result.as_dict()}


async def _handle_confirm_commit(
    job: dict[str, Any], crypto: CryptoService | None
) -> dict[str, Any]:
    """Confirma um apply pendente (trava o rollback automático). ESCRITA — exige approvedBy."""
    import asyncio

    from .drivers import get_driver

    params: dict[str, Any] = job["params"]
    if crypto is None or not params.get("passwordEnc"):
        raise RuntimeError("credencial indisponível para confirmar o commit")
    password = crypto.decrypt(params["passwordEnc"])
    driver = get_driver(params.get("vendor"))

    result = await asyncio.to_thread(
        driver.confirm_commit,
        host=params["mgmtIp"],
        username=params["username"],
        password=password,
        port=_mgmt_port(params.get("vendor"), params),
    )
    return {"kind": "confirm-commit", **result.as_dict()}


def _handle_sync_snmp_config(
    job: dict[str, Any], crypto: CryptoService | None, telegraf_dir: str
) -> dict[str, Any]:
    """Materializa (ou remove) a config SNMP do Telegraf para o device (ADR 0003)."""
    from .telegraf_snmp import remove_snmp_config, write_snmp_config

    device_id = job["deviceId"]
    params: dict[str, Any] = job["params"]
    community_enc = params.get("snmpCommunityEnc")

    if not community_enc:
        removed = remove_snmp_config(config_dir=telegraf_dir, device_id=device_id)
        action = "removed" if removed else "noop"
        return {"kind": "sync-snmp-config", "action": action, "file": None}

    if crypto is None:
        raise RuntimeError("MASTER_KEY não configurada: não dá para decifrar a community")
    community = crypto.decrypt(community_enc)
    path = write_snmp_config(
        config_dir=telegraf_dir,
        device_id=device_id,
        mgmt_ip=params["mgmtIp"],
        community=community,
        version=params.get("snmpVersion", 2),
    )
    return {"kind": "sync-snmp-config", "action": "written", "file": path}


def build_worker(settings: Settings) -> Worker:
    crypto = CryptoService.from_key_b64(settings.master_key) if settings.master_key else None
    telegraf_dir = settings.telegraf_config_dir

    async def processor(job: Job, _token: str) -> dict[str, Any]:
        return await process_job(job, crypto, telegraf_dir)

    return Worker(
        QUEUE_DEVICE_JOBS,
        processor,
        {"connection": settings.redis_url, "concurrency": settings.concurrency},
    )
