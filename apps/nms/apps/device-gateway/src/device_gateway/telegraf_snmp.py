"""Geração da config SNMP do Telegraf por device (ADR 0003), multi-vendor.

OIDs numéricos (sem precisar de MIB files). IF-MIB (tráfego/erros/status) é comum a
todos os vendors → measurement `snmp_interface` igual pros dois, então a tela de
interfaces funciona em Juniper e Mikrotik sem mudança no lado de leitura.

Saúde (temp/CPU) e óptica são por vendor:
- Juniper: jnxOperating (2636.*) + jnxDom óptico → `snmp_juniper_operating` / `snmp_optical`.
- Mikrotik: MIKROTIK-MIB (14988.*) + HOST-RESOURCES (CPU) → `snmp_mikrotik_health` /
  `snmp_host_resources` / `snmp_mikrotik_optical`.
- Cisco IOS-XE: CISCO-PROCESS-MIB (CPU) + CISCO-ENTITY-SENSOR-MIB (temperatura E óptica na
  MESMA tabela de sensores, separadas por `entSensorType`) → `snmp_cisco_cpu` /
  `snmp_cisco_sensor`.

O `metrics.service.ts` lê a tabela certa conforme o vendor do device.
"""

from __future__ import annotations

from pathlib import Path

_HEADER = "# GERADO pelo device-gateway (ADR 0003) — NÃO editar à mão.\n"


def config_path(config_dir: str, device_id: str) -> Path:
    return Path(config_dir) / f"snmp-{device_id}.conf"


def _agent_block(*, device_id: str, mgmt_ip: str, community: str, version: int, name: str) -> str:
    """Preâmbulo de um bloco [[inputs.snmp]] (agente + sysName tag). `name` = measurement dos escalares."""
    return f"""[[inputs.snmp]]
  agents = ["udp://{mgmt_ip}:161"]
  version = {version}
  community = "{community}"
  timeout = "10s"
  retries = 2
  max_repetitions = 10
  agent_host_tag = "source"
  name = "{name}"
  [inputs.snmp.tags]
    device_id = "{device_id}"

  [[inputs.snmp.field]]
    oid = "1.3.6.1.2.1.1.5.0"
    name = "sysName"
    is_tag = true
"""


_IF_MIB_TABLE = """
  # IF-MIB — tráfego, erros e status por interface (comum a todos os vendors)
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
"""


def _render_juniper(*, device_id: str, mgmt_ip: str, community: str, version: int) -> str:
    block = _agent_block(
        device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version, name="snmp"
    )
    return f"""{_HEADER}
{block}{_IF_MIB_TABLE}
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


def _render_mikrotik(*, device_id: str, mgmt_ip: str, community: str, version: int) -> str:
    # Bloco 1: agente + IF-MIB (mesma measurement `snmp_interface` do Juniper).
    block1 = _agent_block(
        device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version, name="snmp"
    )
    # Bloco 2: saúde/óptica do RouterOS. Os campos escalares vão pra `snmp_mikrotik_health`.
    block2 = _agent_block(
        device_id=device_id,
        mgmt_ip=mgmt_ip,
        community=community,
        version=version,
        name="snmp_mikrotik_health",
    )
    return f"""{_HEADER}
{block1}{_IF_MIB_TABLE}
{block2}
  # MIKROTIK-MIB (mtxrHealth) — temperatura da placa, da CPU e tensão (escalares).
  # Unidades variam por modelo/versão (alguns reportam deci-°C); a escala fica na apresentação.
  [[inputs.snmp.field]]
    oid = "1.3.6.1.4.1.14988.1.1.3.10.0"
    name = "boardTempC"
  [[inputs.snmp.field]]
    oid = "1.3.6.1.4.1.14988.1.1.3.11.0"
    name = "cpuTempC"
  [[inputs.snmp.field]]
    oid = "1.3.6.1.4.1.14988.1.1.3.8.0"
    name = "voltageDV"

  # HOST-RESOURCES — carga de CPU por núcleo (%). O metrics.service tira a média.
  [[inputs.snmp.table]]
    name = "snmp_host_resources"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.25.3.3.1.2"
      name = "hrProcessorLoad"

  # MIKROTIK-MIB (mtxrOptical) — DOM dos SFP, indexado pela interface (mtxrOpticalName).
  # rx/tx em centésimos de dBm (mesma convenção do lado Juniper); temp em °C.
  [[inputs.snmp.table]]
    name = "snmp_mikrotik_optical"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.14988.1.1.19.1.1.2"
      name = "ifName"
      is_tag = true
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.14988.1.1.19.1.1.9"
      name = "rxLaserPower"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.14988.1.1.19.1.1.8"
      name = "txLaserOutputPower"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.14988.1.1.19.1.1.5"
      name = "moduleTemperature"
"""


def _render_cisco_iosxe(*, device_id: str, mgmt_ip: str, community: str, version: int) -> str:
    block = _agent_block(
        device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version, name="snmp"
    )
    return f"""{_HEADER}
{block}{_IF_MIB_TABLE}
  # CISCO-PROCESS-MIB — carga de CPU (média de 5 min) por entidade de CPU.
  # O `metrics.service.ts` tira a média das entidades.
  [[inputs.snmp.table]]
    name = "snmp_cisco_cpu"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.9.9.109.1.1.1.1.8"
      name = "cpmCPUTotal5minRev"

  # CISCO-ENTITY-SENSOR-MIB + ENTITY-MIB — uma linha por SENSOR (temperatura de placa,
  # dBm de SFP, tensão…), não por interface: o IOS-XE não indexa DOM por ifIndex como o
  # Juniper/Mikrotik. As duas tabelas são indexadas por entPhysicalIndex, então o Telegraf
  # junta `entPhysicalName` ("Te0/0/2 Transceiver Receive Power Sensor") com o valor.
  # Valores BRUTOS: o real é entSensorValue / 10^entSensorPrecision — a escala fica no
  # `metrics.service.ts`, que também separa óptica (entSensorType 14 = dBm) de saúde
  # (entSensorType 8 = celsius).
  [[inputs.snmp.table]]
    name = "snmp_cisco_sensor"
    inherit_tags = ["device_id", "sysName"]
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.2.1.47.1.1.1.1.7"
      name = "entPhysicalName"
      is_tag = true
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.9.9.91.1.1.1.1.1"
      name = "entSensorType"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.9.9.91.1.1.1.1.3"
      name = "entSensorPrecision"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.9.9.91.1.1.1.1.4"
      name = "entSensorValue"
    [[inputs.snmp.table.field]]
      oid = "1.3.6.1.4.1.9.9.91.1.1.1.1.5"
      name = "entSensorStatus"
"""


def render_snmp_config(
    *, device_id: str, mgmt_ip: str, community: str, version: int = 2, vendor: str | None = None
) -> str:
    """Renderiza a config SNMP do Telegraf para o device, conforme o vendor."""
    key = (vendor or "").strip().lower()
    if key == "mikrotik":
        return _render_mikrotik(
            device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version
        )
    if key == "cisco_iosxe":
        return _render_cisco_iosxe(
            device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version
        )
    return _render_juniper(
        device_id=device_id, mgmt_ip=mgmt_ip, community=community, version=version
    )


def write_snmp_config(
    *,
    config_dir: str,
    device_id: str,
    mgmt_ip: str,
    community: str,
    version: int = 2,
    vendor: str | None = None,
) -> str:
    path = config_path(config_dir, device_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        render_snmp_config(
            device_id=device_id,
            mgmt_ip=mgmt_ip,
            community=community,
            version=version,
            vendor=vendor,
        ),
        encoding="utf-8",
    )
    return str(path)


def remove_snmp_config(*, config_dir: str, device_id: str) -> bool:
    path = config_path(config_dir, device_id)
    if path.exists():
        path.unlink()
        return True
    return False
