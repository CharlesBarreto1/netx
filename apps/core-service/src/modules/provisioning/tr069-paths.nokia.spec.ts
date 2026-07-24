/**
 * Testes do perfil Nokia (tr069-paths.nokia) e da fiação no registry.
 *
 * Modelo base G-1426G-A (AX3000), dump de GetParameterNames (export GenieACS,
 * 4032 params, 2026-07-24, base ZUX-PR). Extensão vendor X_ALU-COM_, raiz
 * TR-098.
 *
 * Invariantes travadas aqui:
 *   - manufacturer "Nokia"/"Alcatel-Lucent"/"ALCL" resolve pra NOKIA; o serial
 *     GPON "ALCL..." infere NOKIA no placeholder pré-Inform;
 *   - PPPoE na WANConnectionDevice.1; VLAN em X_CT-COM_WANGponLinkConfig.VLANIDMark;
 *   - WLAN 1 = 2.4GHz, WLAN 5 = 5GHz (convenção Broadcom/Nokia = Huawei/Parks-6xx);
 *   - senha Wi-Fi = KeyPassphrase no nível da WLAN;
 *   - diagnóstico INCLUI óptico (X_ALU_OntOpticalParam, objeto global) — DIFERENTE
 *     da Parks; NUNCA carrega paths de óptico de OUTRO vendor (X_HW/typo Huawei,
 *     X_CT-COM/VSOL, X_ZTE-COM); recursos são TR-098 padrão.
 */
import {
  diagnosticParamNamesFor,
  isNokia,
  notificationAttributesFor,
  placeholderIdentityFor,
  provisioningPathsFor,
  vendorFor,
} from './tr069-paths.registry';
import {
  nokiaDiagnosticParamNames,
  nokiaProvisioningPaths,
  nokiaWlanSecurityParams,
  NOKIA_OPTICAL_PATHS,
  NOKIA_OPTICAL_STATUS_PATH,
} from './tr069-paths.nokia';

const PPP_WAN1 = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
const WLAN = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';

describe('registry — detecção de vendor Nokia', () => {
  it('manufacturer "Nokia"/"Alcatel-Lucent"/"ALCL" resolve pra NOKIA', () => {
    expect(isNokia('Nokia')).toBe(true);
    expect(isNokia('Alcatel-Lucent')).toBe(true);
    expect(isNokia('ALCL')).toBe(true);
    expect(vendorFor('Nokia')).toBe('NOKIA');
    expect(vendorFor('ALCL')).toBe('NOKIA');
  });

  it('placeholder pré-Inform infere Nokia pelo prefixo do SN "ALCL"', () => {
    expect(vendorFor(null, 'ALCLB40A1234')).toBe('NOKIA');
    const id = placeholderIdentityFor('ALCLB40A1234');
    expect(id.vendor).toBe('NOKIA');
    expect(id.manufacturer).toBe('Nokia');
    expect(id.deviceId).toBe('D89EF3-ALCLB40A1234');
  });

  it('não regride os demais vendors', () => {
    expect(vendorFor('Huawei Technologies Co., Ltd')).toBe('HUAWEI');
    expect(vendorFor('Realtek')).toBe('VSOL');
    expect(vendorFor('ZTE')).toBe('ZTE');
    expect(vendorFor('ZYXEL')).toBe('ZYXEL');
    expect(vendorFor('PARKS')).toBe('PARKS');
    // "nokia" no meio não engana os outros, e os outros não engancham em nokia.
    expect(isNokia('Huawei')).toBe(false);
    expect(isNokia('PARKS')).toBe(false);
  });
});

describe('provisioningPathsFor(NOKIA) — WAN 1, VLAN X_CT-COM, WLAN 1=2.4G/5=5G', () => {
  const P = provisioningPathsFor('NOKIA', 'G-1426G-A');

  it('PPPoE aponta pra WANConnectionDevice.1', () => {
    expect(P.pppoeUsername).toBe(`${PPP_WAN1}.Username`);
    expect(P.pppoePassword).toBe(`${PPP_WAN1}.Password`);
    expect(P.pppoeEnable).toBe(`${PPP_WAN1}.Enable`);
  });

  it('VLAN é a extensão X_CT-COM_WANGponLinkConfig.VLANIDMark (não a WANPPPConnection)', () => {
    expect(P.pppoeVlan).toBe(
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_CT-COM_WANGponLinkConfig.VLANIDMark',
    );
    // ⚠️ NÃO é vazio (ao contrário da Parks 6xx) — a Nokia tem leaf de VLAN real.
    expect(P.pppoeVlan).not.toBe('');
  });

  it('WLAN 1 = 2.4GHz e WLAN 5 = 5GHz (convenção Broadcom/Nokia)', () => {
    expect(P.ssid24).toBe(`${WLAN}.1.SSID`);
    expect(P.ssid50).toBe(`${WLAN}.5.SSID`);
  });

  it('senha Wi-Fi é KeyPassphrase no nível da WLAN', () => {
    expect(P.pwd24).toBe(`${WLAN}.1.KeyPassphrase`);
    expect(P.pwd50).toBe(`${WLAN}.5.KeyPassphrase`);
  });

  it('é a fonte única consumida pelo registry (sem divergência)', () => {
    expect(provisioningPathsFor('NOKIA')).toEqual(nokiaProvisioningPaths());
  });
});

describe('diagnosticParamNamesFor(NOKIA) — COM óptico, sem paths de outros vendors', () => {
  const names = diagnosticParamNamesFor('Nokia', 'G-1426G-A');

  it('usa o perfil Nokia (mesma lista de nokiaDiagnosticParamNames)', () => {
    expect(names).toEqual(nokiaDiagnosticParamNames());
  });

  it('INCLUI óptico do objeto global X_ALU_OntOpticalParam (diferente da Parks)', () => {
    expect(names).toContain(NOKIA_OPTICAL_PATHS.rxPower);
    expect(names).toContain(NOKIA_OPTICAL_PATHS.txPower);
    expect(names).toContain(NOKIA_OPTICAL_PATHS.temperature);
    expect(names).toContain(NOKIA_OPTICAL_STATUS_PATH);
    // óptico Nokia é objeto GLOBAL — nunca sob WANDevice.
    expect(names.some((n) => n.startsWith('InternetGatewayDevice.X_ALU_OntOpticalParam.'))).toBe(true);
  });

  it('NUNCA carrega óptico/recursos de OUTRO vendor', () => {
    const joined = names.join('\n');
    expect(joined).not.toContain('X_GponInterafceConfig'); // typo Huawei
    expect(joined).not.toContain('X_CT-COM_GponInterfaceConfig'); // VSOL
    expect(joined).not.toContain('X_ZTE-COM_'); // ZTE
    expect(joined).not.toContain('X_HW_'); // Huawei
    expect(joined).not.toContain('X_RTK_'); // Parks 5xx
  });

  it('pede SÓ a temperatura da placa — NÃO CPU/mem TR-098 (Nokia os zera ao vivo)', () => {
    const joined = names.join('\n');
    expect(joined).toContain('DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value');
    // CPU/mem TR-098 vêm zerados neste firmware — não pedimos pra não gravar 0% falso.
    expect(joined).not.toContain('DeviceInfo.ProcessStatus.CPUUsage');
    expect(joined).not.toContain('DeviceInfo.MemoryStatus.Total');
  });

  it('PPPoE de diagnóstico na WAN 1 (não a WAN 2 do Huawei)', () => {
    expect(names).toContain(`${PPP_WAN1}.ConnectionStatus`);
    expect(names.some((n) => n.includes('WANConnectionDevice.2'))).toBe(false);
  });

  it('óptico pede o objeto global X_ALU_OntOpticalParam (não sob WANDevice)', () => {
    // ✅ confirmado ao vivo: RX/TX/temp/volt/bias existem sob o objeto global.
    for (const leaf of ['RXPower', 'TXPower', 'TransceiverTemperature', 'SupplyVottage', 'BiasCurrent']) {
      expect(names).toContain(`InternetGatewayDevice.X_ALU_OntOpticalParam.${leaf}`);
    }
    // nunca sob WANDevice (é o objeto global) nem o typo Huawei.
    expect(names.every((n) => !/WANDevice\.\d+\.X_.*Optical|GponInterafceConfig/.test(n))).toBe(true);
  });
});

// Mapa de banda das 8 WLANs confirmado ao vivo (dump GET com valores, base
// ZUX-PR 2026-07-24): WLAN 1-4 Standard "b,g,n,ax"/Freq 2.4GHz; 5-8 "a,n,ac,ax"/
// 5GHz. As primárias (SSID do cliente) são WLAN 1 (2.4G) e WLAN 5 (5G).
describe('mapa de banda das WLANs (confirmado ao vivo)', () => {
  it('provisionamento usa WLAN 1 (2.4G) e WLAN 5 (5G)', () => {
    const P = provisioningPathsFor('NOKIA', 'G-1426G-A');
    expect(P.ssid24).toBe(`${WLAN}.1.SSID`);
    expect(P.ssid50).toBe(`${WLAN}.5.SSID`);
  });
});

describe('notificationAttributesFor(NOKIA)', () => {
  const attrs = notificationAttributesFor('Nokia', 'G-1426G-A');

  it('arma óptico Status + PPP Status como ATIVA (2)', () => {
    const active = attrs.filter((a) => a.notification === 2).map((a) => a.name);
    expect(active).toContain(NOKIA_OPTICAL_STATUS_PATH);
    expect(active).toContain(`${PPP_WAN1}.ConnectionStatus`);
  });

  it('arma níveis ópticos como PASSIVA (1) — vão de carona no Inform', () => {
    const passive = attrs.filter((a) => a.notification === 1).map((a) => a.name);
    expect(passive).toContain(NOKIA_OPTICAL_PATHS.rxPower);
    expect(passive).toContain(NOKIA_OPTICAL_PATHS.txPower);
  });
});

describe('nokiaWlanSecurityParams — nunca abre a rede', () => {
  it('WPA2 puro = BeaconType 11i + PSK/AES', () => {
    const wpa2 = nokiaWlanSecurityParams('5G', 'WPA2');
    expect(wpa2[0]).toEqual({
      name: `${WLAN}.5.BeaconType`,
      value: '11i',
      type: 'xsd:string',
    });
  });

  it('nenhum modo None/WEP em nenhuma banda/variante', () => {
    const all = [
      ...nokiaWlanSecurityParams('2.4G', 'WPA2'),
      ...nokiaWlanSecurityParams('5G', 'WPA_WPA2'),
    ];
    expect(all.some((p) => /none|wep/i.test(p.value))).toBe(false);
  });
});
