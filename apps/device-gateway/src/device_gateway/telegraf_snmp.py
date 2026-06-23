"""Geração da config SNMP do Telegraf por device (ADR 0003).

OIDs numéricos (sem precisar de MIB files): IF-MIB para tráfego/erros/status e jnxOperating
(Juniper) para temperatura/CPU. DOM óptico entra num incremento seguinte.
"""

from __future__ import annotations

from pathlib import Path

_HEADER = "# GERADO pelo device-gateway (ADR 0003) — NÃO editar à mão.\n"


def config_path(config_dir: str, device_id: str) -> Path:
    return Path(config_dir) / f"snmp-{device_id}.conf"


def render_snmp_config(*, device_id: str, mgmt_ip: str, community: str, version: int = 2) -> str:
    # community entre aspas; o valor vem do cofre (decifrado só aqui).
    return f"""{_HEADER}
[[inputs.snmp]]
  agents = ["udp://{mgmt_ip}:161"]
  version = {version}
  community = "{community}"
  timeout = "10s"
  retries = 2
  max_repetitions = 10
  agent_host_tag = "source"
  [inputs.snmp.tags]
    device_id = "{device_id}"

  [[inputs.snmp.field]]
    oid = "1.3.6.1.2.1.1.5.0"
    name = "sysName"
    is_tag = true

  # IF-MIB — tráfego, erros e status por interface
  [[inputs.snmp.table]]
    name = "snmp_interface"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.31.1.1.1.1"
      name = "ifName"
      is_tag = true
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.31.1.1.1.18"
      name = "ifAlias"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.31.1.1.1.15"
      name = "ifHighSpeed"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.31.1.1.1.6"
      name = "ifHCInOctets"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.31.1.1.1.10"
      name = "ifHCOutOctets"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.2.2.1.14"
      name = "ifInErrors"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.2.2.1.20"
      name = "ifOutErrors"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.2.2.1.8"
      name = "ifOperStatus"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.2.2.1.7"
      name = "ifAdminStatus"

  # jnxOperating (Juniper) — temperatura e CPU dos componentes
  [[inputs.snmp.table]]
    name = "snmp_juniper_operating"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.1.13.1.5"
      name = "jnxOperatingDescr"
      is_tag = true
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.1.13.1.7"
      name = "jnxOperatingTemp"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.1.13.1.8"
      name = "jnxOperatingCPU"

  # DOM óptico (jnxDomCurrentTable, index = ifIndex) — luz RX/TX dos transceivers.
  # Valores BRUTOS: rx/tx em centésimos de dBm (ex.: -372 = -3.72 dBm); bias em µA;
  # temp em °C. A escala fica para a camada de apresentação.
  [[inputs.snmp.table]]
    name = "snmp_optical"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.31.1.1.1.1"
      name = "ifName"
      is_tag = true
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.60.1.1.1.1.5"
      name = "rxLaserPower"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.60.1.1.1.1.7"
      name = "txLaserOutputPower"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.60.1.1.1.1.6"
      name = "txLaserBiasCurrent"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.2636.3.60.1.1.1.1.8"
      name = "moduleTemperature"
"""


def write_snmp_config(
    *, config_dir: str, device_id: str, mgmt_ip: str, community: str, version: int = 2
) -> str:
    path = config_path(config_dir, device_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_snmp_config(
        device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version
    ), encoding="utf-8")
    return str(path)


def remove_snmp_config(*, config_dir: str, device_id: str) -> bool:
    path = config_path(config_dir, device_id)
    if path.exists():
        path.unlink()
        return True
    return False
