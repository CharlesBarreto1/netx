/**
 * Testes do perfil ZTE F670L (tr069-paths.zte) e da sua fiação no registry —
 * detecção de vendor por manufacturer/SN, placeholder pré-Inform, paths de
 * provisionamento (WAN 1!) e a estratégia anti-fault do GET de diagnóstico.
 *
 * Invariantes travadas aqui (walk completo ao vivo no piloto PY
 * 6CD2A2-ZTEGC6A2F09E, jul/2026 — 2198 params):
 *   - PPPoE de internet é WANConnectionDevice.1 (Huawei usa .2) — regressão
 *     aqui enfileira SET/GET na WAN errada;
 *   - senha Wi-Fi é WLANConfiguration.{i}.KeyPassphrase (nível da WLAN — NÃO
 *     PreSharedKey.1.* como Zyxel/VSOL) e VLAN é X_ZTE-COM_VLANID na própria
 *     WANPPPConnection — ambos corrigidos pelo walk;
 *   - o GET de diagnóstico usa PATHS PARCIAIS (fault 9005 é atômico) e NUNCA
 *     paths Huawei (X_HW_*, typo "Interafce") — o bug que cegou a F670L;
 *   - CPU/memória são X_ZTE-COM_CpuUsed/MemUsed (padrão TR-098 não existe).
 */
import {
  diagnosticParamNamesFor,
  isZte,
  notificationAttributesFor,
  placeholderIdentityFor,
  provisioningPathsFor,
  vendorFor,
} from './tr069-paths.registry';
import {
  ZTE_PON_IFACE_PATH,
  zteDiagnosticParamNames,
  zteWlanPaths,
  zteWlanSecurityParams,
} from './tr069-paths.zte';

const PPP_WAN1 = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';

describe('registry — detecção de vendor ZTE', () => {
  it('manufacturer "ZTE" (Inform real) resolve pra ZTE', () => {
    expect(isZte('ZTE')).toBe(true);
    expect(vendorFor('ZTE')).toBe('ZTE');
  });

  it('placeholder pré-Inform infere ZTE pelo prefixo do SN GPON "ZTEG"', () => {
    expect(vendorFor(null, 'ZTEGC6A2F09E')).toBe('ZTE');
    const id = placeholderIdentityFor('ZTEGC6A2F09E');
    // Na ZTE o SN CWMP É o SN GPON — o deviceId do placeholder casa direto
    // com o real do Inform (diferente do Huawei, que deriva).
    expect(id.deviceId).toBe('6CD2A2-ZTEGC6A2F09E');
    expect(id.manufacturer).toBe('ZTE');
    expect(id.vendor).toBe('ZTE');
  });

  it('não regride os demais vendors', () => {
    expect(vendorFor('Huawei Technologies Co., Ltd')).toBe('HUAWEI');
    expect(vendorFor('Realtek')).toBe('VSOL');
    expect(vendorFor('ZYXEL')).toBe('ZYXEL');
    expect(vendorFor(null, 'GPON00EF2342')).toBe('VSOL');
    expect(vendorFor(null, 'HWTC12345678')).toBe('HUAWEI');
  });
});

describe('provisioningPathsFor(ZTE) — WAN 1 e KeyPassphrase', () => {
  const P = provisioningPathsFor('ZTE');

  it('PPPoE aponta pra WANConnectionDevice.1 (não a WAN 2 do Huawei)', () => {
    expect(P.pppoeUsername).toBe(`${PPP_WAN1}.Username`);
    expect(P.pppoeEnable).toBe(`${PPP_WAN1}.Enable`);
  });

  it('senha Wi-Fi é KeyPassphrase no NÍVEL DA WLAN (walk: não existe sob PreSharedKey.1)', () => {
    expect(P.pwd24).toBe('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase');
    expect(P.pwd50).toBe('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase');
  });

  it('VLAN é X_ZTE-COM_VLANID na própria WANPPPConnection (walk: =1010)', () => {
    expect(P.pppoeVlan).toBe(`${PPP_WAN1}.X_ZTE-COM_VLANID`);
  });

  it('WLAN 1 = 2.4GHz e WLAN 5 = 5GHz (convenção 1/5, não a invertida VSOL)', () => {
    expect(P.ssid24).toContain('WLANConfiguration.1.SSID');
    expect(P.ssid50).toContain('WLANConfiguration.5.SSID');
  });
});

describe('diagnosticParamNamesFor(ZTE) — estratégia anti-fault', () => {
  const names = diagnosticParamNamesFor('ZTE');

  it('usa o perfil ZTE (mesma lista do zteDiagnosticParamNames)', () => {
    expect(names).toEqual(zteDiagnosticParamNames());
  });

  it('óptico e PPP entram como PATH PARCIAL (terminando em ".")', () => {
    expect(names).toContain(`${ZTE_PON_IFACE_PATH}.`);
    expect(names).toContain(`${PPP_WAN1}.`);
  });

  it('NUNCA inclui paths Huawei (o bug que cegou a F670L)', () => {
    const joined = names.join('\n');
    expect(joined).not.toContain('X_GponInterafceConfig');
    expect(joined).not.toContain('X_HW_');
    expect(joined).not.toContain('WANConnectionDevice.2');
  });

  it('CPU/memória usam as extensões vendor (padrão TR-098 não existe no walk)', () => {
    expect(names).toContain('InternetGatewayDevice.DeviceInfo.X_ZTE-COM_CpuUsed');
    expect(names).toContain('InternetGatewayDevice.DeviceInfo.X_ZTE-COM_MemUsed');
    const joined = names.join('\n');
    expect(joined).not.toContain('ProcessStatus.CPUUsage');
    expect(joined).not.toContain('MemoryStatus');
  });
});

describe('notificationAttributesFor(ZTE)', () => {
  it('arma Status ATIVO (2) + ópticos PASSIVOS (1) no objeto X_ZTE-COM', () => {
    const attrs = notificationAttributesFor('ZTE');
    const status = attrs.find((a) => a.name === `${ZTE_PON_IFACE_PATH}.Status`);
    expect(status?.notification).toBe(2);
    const rx = attrs.find((a) => a.name === `${ZTE_PON_IFACE_PATH}.RXPower`);
    expect(rx?.notification).toBe(1);
    expect(attrs.every((a) => a.name.startsWith(ZTE_PON_IFACE_PATH))).toBe(true);
  });
});

describe('zteWlanPaths / zteWlanSecurityParams', () => {
  it('tuning de rádio usa paths padrão TR-098 nos índices 1/5', () => {
    expect(zteWlanPaths('2.4G').channel).toContain('WLANConfiguration.1.Channel');
    expect(zteWlanPaths('5G').txPower).toContain('WLANConfiguration.5.TransmitPower');
  });

  it('WPA2 puro = BeaconType 11i + PSK/AES; misto inclui WPA* + 11i', () => {
    const wpa2 = zteWlanSecurityParams('5G', 'WPA2');
    expect(wpa2).toHaveLength(3);
    expect(wpa2[0]).toEqual({
      name: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.BeaconType',
      value: '11i',
      type: 'xsd:string',
    });
    const misto = zteWlanSecurityParams('2.4G', 'WPA_WPA2');
    expect(misto.map((p) => p.name.split('.').pop())).toEqual([
      'BeaconType',
      'WPAAuthenticationMode',
      'WPAEncryptionModes',
      'IEEE11iAuthenticationMode',
      'IEEE11iEncryptionModes',
    ]);
    expect(misto[0].value).toBe('WPAand11i');
    // Nunca abre a rede: nenhum modo None/WEP em nenhuma variante.
    expect([...wpa2, ...misto].some((p) => /none|wep/i.test(p.value))).toBe(false);
  });
});
