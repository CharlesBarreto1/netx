/**
 * Testes dos perfis Parks (tr069-paths.parks) e da fiação no registry.
 *
 * A Parks tem DUAS famílias de firmware distintas — travar que o productClass
 * escolhe a certa e que os paths refletem o dump ao vivo (2026-07-23, base
 * ZUX-PR): Fiberlink511 (416-D92205, gSOAP/X_RTK, 4916 params) e Fiberlink_612
 * (416-DFCFE0, easycwmp/X_SKYW, 2450 params).
 *
 * Invariantes travadas aqui:
 *   - manufacturer "PARKS"/"PRKS" (OUI 000416) resolve pra PARKS; ⚠️ "MKTECH"/
 *     "MKPG" (Stavix MP-X4410A) NÃO é Parks;
 *   - 5xx: PPPoE na WAN 1, VLAN em X_RTK_VlanMuxID, WLAN 1=5G/6=2.4G;
 *   - 6xx: PPPoE na WAN 2, SEM leaf de VLAN (vem do preset OLT), WLAN 1=2.4G/5=5G;
 *   - diagnóstico NUNCA usa path parcial (subárvore) nem paths de óptico (a
 *     Parks recusa subárvore e não expõe RX/TX) nem paths Huawei;
 *   - clientes Wi-Fi/hosts entram por ÍNDICE EXPLÍCITO (.1,.2,...).
 */
import {
  diagnosticParamNamesFor,
  isParks,
  notificationAttributesFor,
  placeholderIdentityFor,
  provisioningPathsFor,
  vendorFor,
} from './tr069-paths.registry';
import {
  parksDiagnosticParamNames,
  parksFamilyFor,
  parksProvisioningPaths,
  parksWlanSecurityParams,
} from './tr069-paths.parks';

const PPP_WAN1 = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
const PPP_WAN2 = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1';

describe('registry — detecção de vendor Parks', () => {
  it('manufacturer "PARKS"/"PRKS" resolve pra PARKS', () => {
    expect(isParks('PARKS')).toBe(true);
    expect(isParks('PRKS')).toBe(true);
    expect(vendorFor('PARKS')).toBe('PARKS');
    expect(vendorFor('PRKS')).toBe('PARKS');
  });

  it('⚠️ NÃO confunde Stavix (MKTECH/MKPG) com Parks', () => {
    expect(isParks('MKTECH')).toBe(false);
    expect(vendorFor('MKTECH')).not.toBe('PARKS');
    // "parks" no meio de outra coisa não conta (match é exato).
    expect(isParks('Sparks Networks')).toBe(false);
  });

  it('placeholder pré-Inform infere Parks pelo prefixo do SN "PRKS"', () => {
    expect(vendorFor(null, 'PRKS00D92205')).toBe('PARKS');
    const id = placeholderIdentityFor('PRKS00D92205');
    expect(id.oui).toBe('416');
    expect(id.deviceId).toBe('416-PRKS00D92205');
    expect(id.manufacturer).toBe('PARKS');
    expect(id.vendor).toBe('PARKS');
  });

  it('não regride os demais vendors', () => {
    expect(vendorFor('Huawei Technologies Co., Ltd')).toBe('HUAWEI');
    expect(vendorFor('Realtek')).toBe('VSOL');
    expect(vendorFor('ZTE')).toBe('ZTE');
    expect(vendorFor('ZYXEL')).toBe('ZYXEL');
  });
});

describe('parksFamilyFor — 5xx vs 6xx por productClass', () => {
  it('Fiberlink 611/612 → 6XX', () => {
    expect(parksFamilyFor('Fiberlink_612')).toBe('6XX');
    expect(parksFamilyFor('Fiberlink_611')).toBe('6XX');
  });
  it('Fiberlink 411/501/511 (e desconhecido) → 5XX', () => {
    expect(parksFamilyFor('Fiberlink511')).toBe('5XX');
    expect(parksFamilyFor('Fiberlink501(Rev2)')).toBe('5XX');
    expect(parksFamilyFor('FiberLink411')).toBe('5XX');
    expect(parksFamilyFor(null)).toBe('5XX');
  });
});

describe('provisioningPathsFor(PARKS) — 5xx (WAN 1, X_RTK, WLAN 1=5G/6=2.4G)', () => {
  const P = provisioningPathsFor('PARKS', 'Fiberlink511');

  it('PPPoE aponta pra WANConnectionDevice.1', () => {
    expect(P.pppoeUsername).toBe(`${PPP_WAN1}.Username`);
    expect(P.pppoeEnable).toBe(`${PPP_WAN1}.Enable`);
  });

  it('VLAN é a extensão Realtek X_RTK_VlanMuxID', () => {
    expect(P.pppoeVlan).toBe(`${PPP_WAN1}.X_RTK_VlanMuxID`);
  });

  it('WLAN 1 = 5GHz e WLAN 6 = 2.4GHz (layout próprio 5xx)', () => {
    expect(P.ssid50).toContain('WLANConfiguration.1.SSID');
    expect(P.ssid24).toContain('WLANConfiguration.6.SSID');
  });

  it('senha Wi-Fi é KeyPassphrase no nível da WLAN', () => {
    expect(P.pwd50).toBe('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase');
    expect(P.pwd24).toBe('InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.KeyPassphrase');
  });
});

describe('provisioningPathsFor(PARKS) — 6xx (WAN 2, sem VLAN, WLAN 1=2.4G/5=5G)', () => {
  const P = provisioningPathsFor('PARKS', 'Fiberlink_612');

  it('PPPoE aponta pra WANConnectionDevice.2 (não a WAN 1 do 5xx)', () => {
    expect(P.pppoeUsername).toBe(`${PPP_WAN2}.Username`);
    expect(P.pppoeEnable).toBe(`${PPP_WAN2}.Enable`);
  });

  it('NÃO tem leaf de VLAN (vem do preset OLT) — pppoeVlan vazio', () => {
    expect(P.pppoeVlan).toBe('');
  });

  it('WLAN 1 = 2.4GHz e WLAN 5 = 5GHz (convenção Huawei, INVERSO do 5xx)', () => {
    expect(P.ssid24).toContain('WLANConfiguration.1.SSID');
    expect(P.ssid50).toContain('WLANConfiguration.5.SSID');
  });
});

describe('diagnosticParamNamesFor(PARKS) — anti-fault e sem óptico', () => {
  const names5 = diagnosticParamNamesFor('PARKS', 'Fiberlink511');
  const names6 = diagnosticParamNamesFor('PARKS', 'Fiberlink_612');

  it('usa o perfil Parks (mesma lista de parksDiagnosticParamNames)', () => {
    expect(names5).toEqual(parksDiagnosticParamNames('5XX'));
    expect(names6).toEqual(parksDiagnosticParamNames('6XX'));
  });

  it('⚠️ NUNCA path parcial de subárvore (a Parks recusa — Fault 9005 atômico)', () => {
    for (const names of [names5, names6]) {
      expect(names.every((n) => !n.endsWith('.'))).toBe(true);
    }
  });

  it('⚠️ SEM óptico (nenhuma família expõe RX/TX via TR-069)', () => {
    const joined = [...names5, ...names6].join('\n');
    expect(joined).not.toMatch(/RXPower|TXPower|GponInterface|PONInterface|TransceiverTemperature|BiasCurrent/);
  });

  it('NUNCA inclui paths Huawei (typo/WAN 2/X_HW)', () => {
    // O 5xx é WAN 1: não pode carregar o prefixo WAN 2 do Huawei.
    const joined5 = names5.join('\n');
    expect(joined5).not.toContain('X_GponInterafceConfig');
    expect(joined5).not.toContain('X_HW_');
    expect(joined5).not.toContain('WANConnectionDevice.2');
  });

  it('clientes Wi-Fi e hosts entram por ÍNDICE EXPLÍCITO (.1, .2, …)', () => {
    expect(names5.some((n) => /AssociatedDevice\.1\.AssociatedDeviceMACAddress$/.test(n))).toBe(true);
    expect(names5.some((n) => /Hosts\.Host\.1\.MACAddress$/.test(n))).toBe(true);
    // nunca a subárvore parcial "AssociatedDevice." ou "Hosts.Host."
    expect(names5.some((n) => n.endsWith('AssociatedDevice.') || n.endsWith('Hosts.Host.'))).toBe(false);
  });

  it('recursos usam TR-098 padrão (CPU/mem/temp), não extensão vendor', () => {
    const joined = names5.join('\n');
    expect(joined).toContain('DeviceInfo.ProcessStatus.CPUUsage');
    expect(joined).toContain('DeviceInfo.MemoryStatus.Total');
    expect(joined).toContain('DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value');
    expect(joined).not.toContain('X_HW_CpuUsed');
    expect(joined).not.toContain('X_ZTE-COM_CpuUsed');
  });
});

describe('notificationAttributesFor(PARKS)', () => {
  it('arma só a WAN PPPoE ATIVA (2) — sem óptico', () => {
    const attrs = notificationAttributesFor('PARKS', 'Fiberlink511');
    expect(attrs).toHaveLength(1);
    expect(attrs[0].notification).toBe(2);
    expect(attrs[0].name).toBe(`${PPP_WAN1}.ConnectionStatus`);
    // 6xx arma na WAN 2.
    const attrs6 = notificationAttributesFor('PARKS', 'Fiberlink_612');
    expect(attrs6[0].name).toBe(`${PPP_WAN2}.ConnectionStatus`);
  });
});

describe('parksWlanSecurityParams — nunca abre a rede', () => {
  it('WPA2 puro = BeaconType 11i + PSK/AES', () => {
    const wpa2 = parksWlanSecurityParams('5XX', '5G', 'WPA2');
    expect(wpa2[0]).toEqual({
      name: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType',
      value: '11i',
      type: 'xsd:string',
    });
  });

  it('nenhum modo None/WEP em nenhuma variante/família', () => {
    const all = [
      ...parksWlanSecurityParams('5XX', '2.4G', 'WPA2'),
      ...parksWlanSecurityParams('5XX', '5G', 'WPA_WPA2'),
      ...parksWlanSecurityParams('6XX', '2.4G', 'WPA2'),
      ...parksWlanSecurityParams('6XX', '5G', 'WPA_WPA2'),
    ];
    expect(all.some((p) => /none|wep/i.test(p.value))).toBe(false);
  });
});

// Sanidade extra: o dump provou que parksProvisioningPaths é a fonte única
// consumida pelo registry (sem divergência de path entre os dois).
describe('parksProvisioningPaths ↔ registry consistência', () => {
  it('registry(PARKS, 5xx) == parksProvisioningPaths(5XX)', () => {
    expect(provisioningPathsFor('PARKS', 'Fiberlink511')).toEqual(parksProvisioningPaths('5XX'));
  });
  it('registry(PARKS, 6xx) == parksProvisioningPaths(6XX)', () => {
    expect(provisioningPathsFor('PARKS', 'Fiberlink_612')).toEqual(parksProvisioningPaths('6XX'));
  });
});
