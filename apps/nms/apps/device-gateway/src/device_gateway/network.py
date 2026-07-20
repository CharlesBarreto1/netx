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
    """Parseia ping de Linux/iputils, BSD/Junos, RouterOS (Mikrotik) e IOS-XE (Cisco)."""
    # RouterOS: "sent=4 received=4 packet-loss=0% ... avg-rtt=11ms"
    # Linux/Junos: "4 packets transmitted, 4 received, 0% packet loss ... = min/avg/.."
    # IOS-XE: "Success rate is 100 percent (4/4), round-trip min/avg/max = 1/2/4 ms"
    #   — não diz "transmitted"/"received"/"packet loss" em lugar nenhum, daí o padrão à parte.
    ios = re.search(r"Success rate is (\d+) percent \((\d+)/(\d+)\)", out)
    sent = re.search(r"(\d+) packets transmitted", out) or re.search(r"sent=(\d+)", out)
    recv = re.search(r"(\d+) (?:packets )?received", out) or re.search(r"received=(\d+)", out)
    loss = re.search(r"([\d.]+)% packet loss", out) or re.search(r"packet-loss=([\d.]+)%", out)
    # O "round-trip min/avg/max =" do IOS já casa com este padrão.
    rtt = re.search(r"(?:rtt|round-trip)[^=]*=\s*[\d.]+/([\d.]+)/", out) or re.search(
        r"avg-rtt=([\d.]+)", out
    )

    n_sent = int(sent.group(1)) if sent else (int(ios.group(3)) if ios else None)
    n_recv = int(recv.group(1)) if recv else (int(ios.group(2)) if ios else None)
    loss_pct = float(loss.group(1)) if loss else (100.0 - float(ios.group(1)) if ios else None)
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


def _device_cmd(vendor: str, test_type: str, target: str) -> str:
    """Comando que TERMINA, por vendor (RouterOS/Junos/genérico)."""
    v = (vendor or "").lower()
    if v == "mikrotik":
        # RouterOS: precisa de count= senão roda pra sempre; traceroute idem.
        if test_type == "traceroute":
            return f"/tool traceroute {target} count=3 use-dns=no"
        return f"/ping {target} count=4"
    if v == "juniper":
        if test_type == "traceroute":
            return f"traceroute {target} wait 2"
        return f"ping {target} count 4"
    if v == "parks":
        # Parks OS: `ping <ip>` já manda 5 pacotes e termina sozinho — não aceita `repeat`
        # nem `count`. A saída é Cisco-style ("Success rate is ..."), então o parser do IOS
        # em `_ping_summary` já cobre.
        return f"traceroute {target}" if test_type == "traceroute" else f"ping {target}"
    if v == "cisco_iosxe":
        # IOS: sem `repeat`/`ttl` explícitos o default é lento (5 probes de 2s por hop, 30 hops).
        if test_type == "traceroute":
            return f"traceroute {target} probe 1 timeout 2 ttl 1 20"
        return f"ping {target} repeat 4"
    # genérico (Linux): fallback
    if test_type == "traceroute":
        return f"traceroute -w 2 -q 1 -m 20 {target}"
    return f"ping -c 4 -w 10 {target}"


def _run_device(
    test_type: str,
    target: str,
    mgmt_ip: str,
    username: str,
    password: str | None,
    ssh_port: int,
    vendor: str,
) -> str:
    import time

    import paramiko

    cmd = _device_cmd(vendor, test_type, target)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        # Timeouts curtos em TODAS as fases: connect, banner e auth — senão um
        # IP que aceita TCP mas não responde SSH pendura o job (vira "demorou").
        client.connect(
            mgmt_ip,
            port=ssh_port,
            username=username,
            password=password,
            timeout=8.0,
            banner_timeout=8.0,
            auth_timeout=8.0,
            allow_agent=False,
            look_for_keys=False,
        )
        chan = client.get_transport().open_session(timeout=8.0)  # type: ignore[union-attr]
        chan.settimeout(40.0)
        chan.exec_command(cmd)
        # Leitura com deadline rígido (recv_exit_status() não tem timeout próprio).
        deadline = time.time() + 40.0
        buf = bytearray()
        while True:
            while chan.recv_ready():
                buf += chan.recv(4096)
            if chan.exit_status_ready():
                while chan.recv_ready():
                    buf += chan.recv(4096)
                break
            if time.time() > deadline:
                buf += b"\n[timeout: comando nao concluiu em 40s]"
                break
            time.sleep(0.3)
        return buf.decode("utf-8", "replace")
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
    vendor: str = "",
) -> dict[str, Any]:
    """Executa o teste e devolve o dict do NetworkTestResult (sem o envelope)."""
    if source == "device":
        if not mgmt_ip or not username:
            raise RuntimeError("source=device requer mgmtIp e username")
        out = _run_device(test_type, target, mgmt_ip, username, password, ssh_port, vendor)
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
