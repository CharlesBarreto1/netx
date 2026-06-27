"""Testes de rede ativos (ping/traceroute) — read-only.

source='host': roda no próprio container do device-gateway (probe padrão do NOC).
source='device': SSH no equipamento (Junos) e roda o comando lá.

Devolve resultado COMPACTO (resumo de 1 linha + campos estruturados) para o
copiloto não gastar token com stdout verboso; `raw` (truncado) é só para o
render determinístico no Nexus.
"""

from __future__ import annotations

import re
import subprocess
from typing import Any

_RAW_MAX = 4000


def _ping_summary(out: str) -> dict[str, Any]:
    """Parseia saída de ping (Linux iputils e BSD/Junos têm formato próximo)."""
    sent = re.search(r"(\d+) packets transmitted", out)
    recv = re.search(r"(\d+) (?:packets )?received", out)
    loss = re.search(r"([\d.]+)% packet loss", out)
    rtt = re.search(r"(?:rtt|round-trip)[^=]*=\s*[\d.]+/([\d.]+)/", out)

    n_sent = int(sent.group(1)) if sent else None
    n_recv = int(recv.group(1)) if recv else None
    loss_pct = float(loss.group(1)) if loss else None
    avg_ms = float(rtt.group(1)) if rtt else None
    reachable = bool(n_recv and n_recv > 0)

    parts: list[str] = []
    if n_recv is not None and n_sent is not None:
        parts.append(f"{n_recv}/{n_sent} pacotes")
    if avg_ms is not None:
        parts.append(f"{avg_ms:.1f}ms médio")
    if loss_pct is not None:
        parts.append(f"{loss_pct:.0f}% perda")

    return {
        "reachable": reachable,
        "summary": ", ".join(parts) or ("respondeu" if reachable else "sem resposta"),
        "rttMs": avg_ms,
        "lossPct": loss_pct,
    }


def _trace_summary(out: str) -> dict[str, Any]:
    """Conta hops (linhas que começam com número)."""
    hops = [ln for ln in out.splitlines() if re.match(r"\s*\d+\s", ln)]
    n = len(hops)
    last_blind = bool(hops and hops[-1].count("*") >= 3)
    return {
        "reachable": n > 0,
        "summary": f"{n} hops" + (" (último sem resposta)" if last_blind else ""),
        "hops": n,
    }


def _run_host(test_type: str, target: str) -> str:
    if test_type == "traceroute":
        cmd = ["traceroute", "-w", "2", "-q", "1", "-m", "20", target]
        timeout = 60
    else:
        cmd = ["ping", "-c", "4", "-w", "10", target]
        timeout = 20
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)  # noqa: S603
        return proc.stdout or proc.stderr
    except FileNotFoundError:
        return f"comando '{cmd[0]}' não instalado no gateway"
    except subprocess.TimeoutExpired:
        return "timeout ao executar o teste"


def _run_device(
    test_type: str,
    target: str,
    mgmt_ip: str,
    username: str,
    password: str | None,
    ssh_port: int,
) -> str:
    import paramiko

    # Sintaxe Junos (NMS MVP é Juniper-only).
    cmd = f"traceroute {target}" if test_type == "traceroute" else f"ping {target} count 4"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            mgmt_ip,
            port=ssh_port,
            username=username,
            password=password,
            timeout=10.0,
            allow_agent=False,
            look_for_keys=False,
        )
        _stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
        stdout.channel.recv_exit_status()
        out = stdout.read().decode("utf-8", "replace")
        return out or stderr.read().decode("utf-8", "replace")
    finally:
        client.close()


def run_network_test(
    *,
    test_type: str,
    target: str,
    source: str,
    mgmt_ip: str | None = None,
    username: str | None = None,
    password: str | None = None,
    ssh_port: int = 22,
) -> dict[str, Any]:
    """Executa o teste e devolve o dict do NetworkTestResult (sem o envelope)."""
    if source == "device":
        if not mgmt_ip or not username:
            raise RuntimeError("source=device requer mgmtIp e username")
        out = _run_device(test_type, target, mgmt_ip, username, password, ssh_port)
    else:
        out = _run_host(test_type, target)

    parsed = _trace_summary(out) if test_type == "traceroute" else _ping_summary(out)
    return {
        "kind": "network-test",
        "testType": test_type,
        "target": target,
        "source": source,
        "raw": out[:_RAW_MAX],
        **parsed,
    }
