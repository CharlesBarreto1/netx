from device_gateway.telegraf_snmp import (
    config_path,
    remove_snmp_config,
    render_snmp_config,
    write_snmp_config,
)

DEV = "11111111-1111-1111-1111-111111111111"


def test_render_inclui_agente_community_e_oids():
    cfg = render_snmp_config(device_id=DEV, mgmt_ip="10.66.0.1", community="zux-ro", version=2)
    assert 'agents = ["udp://10.66.0.1:161"]' in cfg
    assert 'community = "zux-ro"' in cfg
    assert f'device_id = "{DEV}"' in cfg
    assert "1.3.6.1.2.1.31.1.1.1.6" in cfg  # ifHCInOctets
    assert "1.3.6.1.4.1.2636.3.1.13.1.7" in cfg  # jnxOperatingTemp
    assert "1.3.6.1.4.1.2636.3.60.1.1.1.1.5" in cfg  # DOM rxLaserPower


def test_render_juniper_default_e_vendor_explicito():
    # Default (sem vendor) e vendor=juniper produzem OIDs Juniper, nunca Mikrotik.
    for v in (None, "juniper", "JUNIPER"):
        cfg = render_snmp_config(device_id=DEV, mgmt_ip="10.0.0.1", community="c", vendor=v)
        assert "snmp_juniper_operating" in cfg
        assert "14988" not in cfg


def test_render_mikrotik_usa_mtxr_e_iftable_comum():
    cfg = render_snmp_config(device_id=DEV, mgmt_ip="10.0.0.1", community="c", vendor="mikrotik")
    # IF-MIB compartilhada (mesma measurement do Juniper → tela de interfaces funciona)
    assert 'name = "snmp_interface"' in cfg
    assert "1.3.6.1.2.1.31.1.1.1.6" in cfg  # ifHCInOctets
    # Saúde/óptica via MIKROTIK-MIB, não jnx*
    assert "1.3.6.1.4.1.14988.1.1.3.10.0" in cfg  # mtxrHlTemperature
    assert 'name = "snmp_mikrotik_health"' in cfg
    assert 'name = "snmp_host_resources"' in cfg  # hrProcessorLoad
    assert 'name = "snmp_mikrotik_optical"' in cfg
    assert "2636" not in cfg  # nenhum OID Juniper


def test_render_cisco_iosxe_usa_process_e_entity_sensor():
    cfg = render_snmp_config(device_id=DEV, mgmt_ip="10.0.0.1", community="c", vendor="cisco_iosxe")
    # IF-MIB compartilhada (mesma measurement dos outros vendors → tela de interfaces igual)
    assert 'name = "snmp_interface"' in cfg
    assert "1.3.6.1.2.1.31.1.1.1.6" in cfg  # ifHCInOctets
    # CPU via CISCO-PROCESS-MIB
    assert "1.3.6.1.4.1.9.9.109.1.1.1.1.8" in cfg  # cpmCPUTotal5minRev
    assert 'name = "snmp_cisco_cpu"' in cfg
    # Temperatura E óptica saem da mesma tabela de sensores (separadas por entSensorType)
    assert 'name = "snmp_cisco_sensor"' in cfg
    assert "1.3.6.1.4.1.9.9.91.1.1.1.1.4" in cfg  # entSensorValue
    assert "1.3.6.1.4.1.9.9.91.1.1.1.1.3" in cfg  # entSensorPrecision (escala)
    assert "1.3.6.1.2.1.47.1.1.1.1.7" in cfg  # entPhysicalName (tag)
    # Nenhum OID de outro vendor
    assert "2636" not in cfg
    assert "14988" not in cfg


def test_render_vendor_desconhecido_cai_em_juniper():
    # `cisco` sozinho não é vendor do NMS — cai no default, nunca gera OID Cisco.
    cfg = render_snmp_config(device_id=DEV, mgmt_ip="10.0.0.1", community="c", vendor="cisco")
    assert "snmp_juniper_operating" in cfg
    assert "9.9.91" not in cfg


def test_write_mikrotik_vendor(tmp_path):
    path = write_snmp_config(
        config_dir=str(tmp_path), device_id=DEV, mgmt_ip="10.0.0.1", community="c", vendor="mikrotik"
    )
    assert "14988" in config_path(str(tmp_path), DEV).read_text(encoding="utf-8")
    assert path.endswith(f"snmp-{DEV}.conf")


def test_write_e_remove(tmp_path):
    d = str(tmp_path)
    path = write_snmp_config(config_dir=d, device_id=DEV, mgmt_ip="10.66.0.1", community="c")
    assert path == str(config_path(d, DEV))
    assert config_path(d, DEV).exists()
    assert remove_snmp_config(config_dir=d, device_id=DEV) is True
    assert remove_snmp_config(config_dir=d, device_id=DEV) is False  # já removido


def test_render_parks_usa_oids_proprios_e_iftable_comum():
    cfg = render_snmp_config(device_id=DEV, mgmt_ip="10.0.0.1", community="c", vendor="parks")
    assert 'name = "snmp_interface"' in cfg  # IF-MIB compartilhada
    # Óptica: coluna única com índice composto <ifIndex>.<param> → index_as_tag é obrigatório
    assert "1.3.6.1.4.1.3893.60.18.1.2.2.1.1.2" in cfg
    assert 'name = "snmp_parks_optical"' in cfg
    assert "index_as_tag = true" in cfg
    assert 'name = "snmp_parks_ifname"' in cfg  # mapa ifIndex→ifName p/ o pivô
    # Saúde: temperatura do chip, memória e as 4 séries de CPU
    assert "1.3.6.1.4.1.3893.15.4.1.1.1.1.1.22.3.1.1.0" in cfg
    assert 'name = "chipTempC"' in cfg
    assert 'name = "memTotalKb"' in cfg
    assert 'name = "cpu4Pct"' in cfg
    # Nenhum OID de outro vendor
    assert "2636" not in cfg
    assert "14988" not in cfg
    assert "9.9.91" not in cfg
