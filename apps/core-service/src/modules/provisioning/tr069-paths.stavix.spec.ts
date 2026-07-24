/**
 * Testes do perfil Stavix/Datacom (tr069-paths.stavix) e da fiação no registry.
 *
 * Modelo base MP-X4410A / DM986-416 AX30 (chipset Realtek), dump COM VALORES
 * (export GenieACS, device 0CF0B4-MKPGB4E18DEB, base ZUX-PR, 2026-07-24).
 * Stavix e Datacom são o MESMO HW rebrandado — um perfil, dois matchers.
 *
 * Invariantes travadas aqui:
 *   - manufacturer "MKTECH" → STAVIX; "Datacom" → STAVIX; serial "MKPG…"/"DACM…"
 *     inferem STAVIX no placeholder pré-Inform (com OUI/manufacturer certos);
 *   - PPPoE na WANConnectionDevice.1 (WAN 1); VLAN em X_CT-COM_VLANIDMark na
 *     própria WANPPPConnection (não no GponLinkConfig da Nokia);
 *   - WLAN INVERTIDO: WLAN 1 = 5GHz, WLAN 6 = 2.4GHz (como VSOL/Parks-5xx);
 *   - senha Wi-Fi = KeyPassphrase no nível da WLAN;
 *   - diagnóstico INCLUI óptico (X_GponInterafceConfig, mesmo objeto do Huawei);
 *     NUNCA carrega paths de óptico de OUTRO vendor (X_ALU/VSOL/X_ZTE/X_RTK);
 *     TransceiverTemperature OMITIDO (campo é lixo); recursos TR-098 padrão.
 */
import {
  diagnosticParamNamesFor,
  isDatacom,
  isStavix,
  isStavixFamily,
  notificationAttributesFor,
  placeholderIdentityFor,
  provisioningPathsFor,
  vendorFor,
} from './tr069-paths.registry';
import {
  stavixDiagnosticParamNames,
  stavixProvisioningPaths,
  stavixWlanSecurityParams,
  STAVIX_OPTICAL_PATHS,
  STAVIX_OPTICAL_STATUS_PATH,
} from './tr069-paths.stavix';

const PPP_WAN1 = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
const WLAN = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';

describe('registry — detecção de vendor Stavix/Datacom', () => {
  it('manufacturer "MKTECH" (Stavix) e "Datacom" resolvem pra STAVIX', () => {
    expect(isStavix('MKTECH')).toBe(true);
    expect(isDatacom('Datacom')).toBe(true);
    expect(isStavixFamily('MKTECH')).toBe(true);
    expect(isStavixFamily('Datacom')).toBe(true);
    expect(vendorFor('MKTECH')).toBe('STAVIX');
    expect(vendorFor('Datacom')).toBe('STAVIX');
  });

  it('placeholder pré-Inform infere STAVIX pelo prefixo do serial (MKPG=Stavix, DACM=Datacom)', () => {
    expect(vendorFor(null, 'MKPGB4E18DEB')).toBe('STAVIX');
    expect(vendorFor(null, 'DACMB4E18DEB')).toBe('STAVIX');

    const stavix = placeholderIdentityFor('MKPGB4E18DEB');
    expect(stavix.vendor).toBe('STAVIX');
    expect(stavix.manufacturer).toBe('MKTECH');
    expect(stavix.oui).toBe('0CF0B4');
    expect(stavix.deviceId).toBe('0CF0B4-MKPGB4E18DEB');

    const datacom = placeholderIdentityFor('DACMB4E18DEB');
    expect(datacom.vendor).toBe('STAVIX');
    expect(datacom.manufacturer).toBe('Datacom');
    expect(datacom.oui).toBe('1881ED');
    expect(datacom.deviceId).toBe('1881ED-DACMB4E18DEB');
  });

  it('não regride os demais vendors, e o chipset Realtek NÃO vira VSOL', () => {
    expect(vendorFor('Huawei Technologies Co., Ltd')).toBe('HUAWEI');
    expect(vendorFor('Realtek')).toBe('VSOL');
    expect(vendorFor('ZTE')).toBe('ZTE');
    expect(vendorFor('ZYXEL')).toBe('ZYXEL');
    expect(vendorFor('PARKS')).toBe('PARKS');
    expect(vendorFor('Nokia')).toBe('NOKIA');
    // ⚠️ o HW é Realtek por dentro, mas reporta "MKTECH"/"Datacom" — NÃO casa VSOL.
    expect(isStavixFamily('Realtek')).toBe(false);
    expect(isStavix('PARKS')).toBe(false); // o "MK" não engana pra cá também
  });
});

describe('provisioningPathsFor(STAVIX) — WAN 1, VLAN X_CT-COM, WLAN 1=5G/6=2.4G', () => {
  const P = provisioningPathsFor('STAVIX', 'MP-X4410A');

  it('PPPoE aponta pra WANConnectionDevice.1', () => {
    expect(P.pppoeUsername).toBe(`${PPP_WAN1}.Username`);
    expect(P.pppoePassword).toBe(`${PPP_WAN1}.Password`);
    expect(P.pppoeEnable).toBe(`${PPP_WAN1}.Enable`);
  });

  it('VLAN é X_CT-COM_VLANIDMark na própria WANPPPConnection (não GponLinkConfig)', () => {
    expect(P.pppoeVlan).toBe(`${PPP_WAN1}.X_CT-COM_VLANIDMark`);
    expect(P.pppoeVlan).not.toContain('WANGponLinkConfig'); // isso é Nokia
    expect(P.pppoeVlan).not.toBe('');
  });

  it('WLAN INVERTIDO: WLAN 1 = 5GHz e WLAN 6 = 2.4GHz (como VSOL/Parks-5xx)', () => {
    expect(P.ssid50).toBe(`${WLAN}.1.SSID`);
    expect(P.ssid24).toBe(`${WLAN}.6.SSID`);
  });

  it('senha Wi-Fi é KeyPassphrase no nível da WLAN', () => {
    expect(P.pwd50).toBe(`${WLAN}.1.KeyPassphrase`);
    expect(P.pwd24).toBe(`${WLAN}.6.KeyPassphrase`);
  });

  it('é a fonte única consumida pelo registry (Stavix e Datacom idênticos)', () => {
    expect(provisioningPathsFor('STAVIX')).toEqual(stavixProvisioningPaths());
  });
});

describe('diagnosticParamNamesFor(STAVIX) — COM óptico, sem paths de outros vendors', () => {
  const names = diagnosticParamNamesFor('MKTECH', 'MP-X4410A');

  it('usa o perfil Stavix (mesma lista, tanto por MKTECH quanto por Datacom)', () => {
    expect(names).toEqual(stavixDiagnosticParamNames());
    expect(diagnosticParamNamesFor('Datacom')).toEqual(stavixDiagnosticParamNames());
  });

  it('INCLUI óptico do X_GponInterafceConfig (mesmo objeto do Huawei, valores diretos)', () => {
    expect(names).toContain(STAVIX_OPTICAL_PATHS.rxPower);
    expect(names).toContain(STAVIX_OPTICAL_PATHS.txPower);
    expect(names).toContain(STAVIX_OPTICAL_PATHS.voltage);
    expect(names).toContain(STAVIX_OPTICAL_PATHS.biasCurrent);
    expect(names).toContain(STAVIX_OPTICAL_STATUS_PATH);
  });

  it('OMITE TransceiverTemperature do óptico (campo é lixo — usa o sensor TR-098)', () => {
    expect(names.some((n) => /X_GponInterafceConfig\.TransceiverTemperature/.test(n))).toBe(false);
    expect(names).toContain(
      'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
    );
  });

  it('NUNCA carrega óptico/recursos de OUTRO vendor', () => {
    const joined = names.join('\n');
    expect(joined).not.toContain('X_ALU_OntOpticalParam'); // Nokia
    expect(joined).not.toContain('X_CT-COM_GponInterfaceConfig'); // VSOL
    expect(joined).not.toContain('X_ZTE-COM_'); // ZTE
    expect(joined).not.toContain('X_HW_'); // Huawei resources
    expect(joined).not.toContain('X_RTK_'); // Parks 5xx
    expect(joined).not.toContain('SupplyVottage'); // typo VSOL/Nokia — a Stavix é "Voltage"
  });

  it('recursos usam TR-098 padrão (CPU/mem/temp), não extensão vendor', () => {
    const joined = names.join('\n');
    expect(joined).toContain('DeviceInfo.ProcessStatus.CPUUsage');
    expect(joined).toContain('DeviceInfo.MemoryStatus.Total');
    expect(joined).toContain('DeviceInfo.MemoryStatus.Free');
  });

  it('PPPoE de diagnóstico na WAN 1 (não a WAN 2 do Huawei)', () => {
    expect(names).toContain(`${PPP_WAN1}.ConnectionStatus`);
    expect(names.some((n) => n.includes('WANConnectionDevice.2'))).toBe(false);
  });

  it('clientes Wi-Fi por ÍNDICE EXPLÍCITO nas WLAN 1 (5G) e 6 (2.4G) — sem RSSI', () => {
    expect(names).toContain(`${WLAN}.1.AssociatedDevice.1.AssociatedDeviceMACAddress`);
    expect(names).toContain(`${WLAN}.6.AssociatedDevice.1.AssociatedDeviceMACAddress`);
    // SEM subárvore parcial (nada terminando em ".AssociatedDevice.")
    expect(names.some((n) => /\.AssociatedDevice\.$/.test(n))).toBe(false);
  });
});

describe('notificationAttributesFor(STAVIX)', () => {
  const attrs = notificationAttributesFor('MKTECH', 'MP-X4410A');

  it('arma óptico Status + PPP Status como ATIVA (2)', () => {
    const active = attrs.filter((a) => a.notification === 2).map((a) => a.name);
    expect(active).toContain(STAVIX_OPTICAL_STATUS_PATH);
    expect(active).toContain(`${PPP_WAN1}.ConnectionStatus`);
  });

  it('arma níveis ópticos como PASSIVA (1) — vão de carona no Inform', () => {
    const passive = attrs.filter((a) => a.notification === 1).map((a) => a.name);
    expect(passive).toContain(STAVIX_OPTICAL_PATHS.rxPower);
    expect(passive).toContain(STAVIX_OPTICAL_PATHS.txPower);
  });
});

describe('stavixWlanSecurityParams — nunca abre a rede', () => {
  it('WPA2 puro = BeaconType 11i + PSK/AES', () => {
    const wpa2 = stavixWlanSecurityParams('5G', 'WPA2');
    expect(wpa2[0]).toEqual({
      name: `${WLAN}.1.BeaconType`,
      value: '11i',
      type: 'xsd:string',
    });
  });

  it('nenhum modo None/WEP em nenhuma banda/variante', () => {
    const all = [
      ...stavixWlanSecurityParams('2.4G', 'WPA2'),
      ...stavixWlanSecurityParams('5G', 'WPA_WPA2'),
    ];
    expect(all.some((p) => /none|wep/i.test(p.value))).toBe(false);
  });
});
