"""Parsing da saída de ping/traceroute e comandos por vendor (não toca rede)."""

from device_gateway.network import _device_cmd, _ping_summary, _trace_summary


def test_ping_summary_linux():
    out = (
        "4 packets transmitted, 4 received, 0% packet loss, time 3005ms\n"
        "rtt min/avg/max/mdev = 10.1/11.2/12.9/0.9 ms\n"
    )
    r = _ping_summary(out)
    assert r["reachable"] is True
    assert r["lossPct"] == 0.0
    assert r["rttMs"] == 11.2


def test_ping_summary_routeros():
    out = "sent=4 received=4 packet-loss=0% min-rtt=9ms avg-rtt=11ms max-rtt=14ms\n"
    r = _ping_summary(out)
    assert r["reachable"] is True
    assert r["rttMs"] == 11.0
    assert r["lossPct"] == 0.0


def test_ping_summary_cisco_ios_sucesso():
    # O IOS não escreve "transmitted"/"received"/"packet loss" — só a taxa de sucesso.
    out = (
        "Type escape sequence to abort.\n"
        "Sending 4, 100-byte ICMP Echos to 8.8.8.8, timeout is 2 seconds:\n"
        "!!!!\n"
        "Success rate is 100 percent (4/4), round-trip min/avg/max = 1/2/4 ms\n"
    )
    r = _ping_summary(out)
    assert r["reachable"] is True
    assert r["lossPct"] == 0.0
    assert r["rttMs"] == 2.0
    assert "4/4 pacotes" in r["summary"]


def test_ping_summary_cisco_ios_perda_parcial():
    out = "Success rate is 60 percent (3/5), round-trip min/avg/max = 1/8/20 ms\n"
    r = _ping_summary(out)
    assert r["reachable"] is True
    assert r["lossPct"] == 40.0
    assert r["rttMs"] == 8.0


def test_ping_summary_cisco_ios_sem_resposta():
    # Destino morto: taxa 0% e nenhuma linha de round-trip.
    out = (
        "Sending 4, 100-byte ICMP Echos to 10.9.9.9, timeout is 2 seconds:\n"
        "....\n"
        "Success rate is 0 percent (0/4)\n"
    )
    r = _ping_summary(out)
    assert r["reachable"] is False
    assert r["lossPct"] == 100.0
    assert r["rttMs"] is None


def test_trace_summary_conta_hops():
    out = "  1 10.0.0.1 1 msec\n  2 10.0.1.1 2 msec\n  3 * * *\n"
    r = _trace_summary(out)
    assert r["hops"] == 3
    assert "último sem resposta" in r["summary"]


def test_device_cmd_por_vendor_sempre_termina():
    # Todo comando precisa de um limite explícito, senão o job pendura esperando prompt.
    assert _device_cmd("cisco_iosxe", "ping", "8.8.8.8") == "ping 8.8.8.8 repeat 4"
    assert "ttl 1 20" in _device_cmd("cisco_iosxe", "traceroute", "8.8.8.8")
    assert _device_cmd("mikrotik", "ping", "8.8.8.8") == "/ping 8.8.8.8 count=4"
    assert _device_cmd("juniper", "ping", "8.8.8.8") == "ping 8.8.8.8 count 4"
    assert "-c 4" in _device_cmd("", "ping", "8.8.8.8")  # fallback genérico (Linux)
