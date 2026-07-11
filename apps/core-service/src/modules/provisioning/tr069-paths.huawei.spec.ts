/**
 * Testes do bloco WiFi-Opt de tr069-paths.huawei — montagem dos params do
 * pacote de otimização (FULL vs WIDTH_ONLY, variante de txpower por
 * capability, RegDomain nas 2 WLANs, SSID unificado, tipos xsd) e do readback.
 *
 * Invariantes empíricas travadas aqui (probe ao vivo, jul/2026):
 *   - X_HW_HT20 NUNCA recebe '0' (auto negocia só 40MHz na prática);
 *   - BandSteeringCapability é READ-ONLY (fault 9003) — jamais num SET;
 *   - PSK nunca aparece no readback (write-only no CPE).
 */
import {
  HUAWEI_APM_POWER_SAVING,
  HUAWEI_BAND_STEERING_CAPABILITY,
  HUAWEI_EG8145_PATHS,
  HUAWEI_ROUTER_PATHS,
  HUAWEI_TXPOWER_GLOBAL,
  huaweiRegDomain,
  huaweiWifiOptParams,
  huaweiWifiOptReadbackNames,
  huaweiWlanPaths,
  huaweiWlanTxpower,
} from './tr069-paths.huawei';
import type { HuaweiWifiCapability } from './wifi-opt.resolver';

const CAP_AX: HuaweiWifiCapability = {
  ax: true,
  txpower: 'X_HW_TXPOWER',
  maxWidthCode: '4',
  ht20: true,
};
const CAP_V5: HuaweiWifiCapability = {
  ax: false,
  txpower: 'WLAN_TRANSMIT_POWER',
  maxWidthCode: '3',
  ht20: true,
};

const HT20_5G = huaweiWlanPaths('5G').htMode;

const byName = (params: Array<{ name: string; value: string; type: string }>) =>
  new Map(params.map((p) => [p.name, p]));

describe('huaweiWifiOptParams — FULL', () => {
  const params = huaweiWifiOptParams({
    cap: CAP_AX,
    profile: 'GIGA',
    regDomain: 'PY',
    ssid: 'Charles',
    psk: 'segredo123',
    mode: 'FULL',
  });
  const map = byName(params);

  it('txpower global (X6/X10) = 100, unsignedInt', () => {
    expect(map.get(HUAWEI_TXPOWER_GLOBAL)).toEqual({
      name: HUAWEI_TXPOWER_GLOBAL,
      value: '100',
      type: 'xsd:unsignedInt',
    });
    // Variante global não mistura com TransmitPower por WLAN.
    expect(map.has(huaweiWlanTxpower(1))).toBe(false);
    expect(map.has(huaweiWlanTxpower(5))).toBe(false);
  });

  it('APM (economia de energia) desligado, boolean', () => {
    expect(map.get(HUAWEI_APM_POWER_SAVING)).toEqual({
      name: HUAWEI_APM_POWER_SAVING,
      value: '0',
      type: 'xsd:boolean',
    });
  });

  it('RegDomain nas DUAS WLANs (1=2.4G, 5=5G), string', () => {
    for (const i of [1, 5]) {
      expect(map.get(huaweiRegDomain(i))).toEqual({
        name: huaweiRegDomain(i),
        value: 'PY',
        type: 'xsd:string',
      });
    }
  });

  it('SSID 5G = MESMO nome da 2.4G (band steering unificado) + PSK', () => {
    expect(map.get(HUAWEI_EG8145_PATHS.ssid50)?.value).toBe('Charles');
    expect(map.get(HUAWEI_EG8145_PATHS.pwd50)?.value).toBe('segredo123');
    expect(map.get(HUAWEI_EG8145_PATHS.ssid50)?.type).toBe('xsd:string');
  });

  it('BandSteeringPolicy=1 e NUNCA a Capability (read-only, fault 9003)', () => {
    expect(map.get(HUAWEI_ROUTER_PATHS.bandSteeringPolicy)).toEqual({
      name: HUAWEI_ROUTER_PATHS.bandSteeringPolicy,
      value: '1',
      type: 'xsd:unsignedInt',
    });
    expect(map.has(HUAWEI_BAND_STEERING_CAPABILITY)).toBe(false);
  });

  it("GIGA → largura '4' (160MHz) na WLAN 5, unsignedInt", () => {
    expect(map.get(HT20_5G)).toEqual({
      name: HT20_5G,
      value: '4',
      type: 'xsd:unsignedInt',
    });
  });

  it('V5 plain → TransmitPower por WLAN (1 e 5) em vez do global', () => {
    const v5 = byName(
      huaweiWifiOptParams({
        cap: CAP_V5,
        profile: 'BASE',
        regDomain: 'PY',
        ssid: 'Charles',
        psk: 'segredo123',
        mode: 'FULL',
      }),
    );
    expect(v5.has(HUAWEI_TXPOWER_GLOBAL)).toBe(false);
    expect(v5.get(huaweiWlanTxpower(1))?.value).toBe('100');
    expect(v5.get(huaweiWlanTxpower(5))?.value).toBe('100');
    // BASE em AC também fixa 80MHz ('3') — auto '0' nunca entra.
    expect(v5.get(HT20_5G)?.value).toBe('3');
  });

  it("'0' (auto) jamais aparece como valor de X_HW_HT20", () => {
    for (const cap of [CAP_AX, CAP_V5]) {
      for (const profile of ['BASE', 'GIGA'] as const) {
        const p = huaweiWifiOptParams({
          cap,
          profile,
          regDomain: 'PY',
          ssid: 's',
          psk: 'p',
          mode: 'FULL',
        }).find((x) => x.name === HT20_5G);
        expect(p?.value).not.toBe('0');
      }
    }
  });
});

describe('huaweiWifiOptParams — WIDTH_ONLY', () => {
  it('só X_HW_HT20 (sem SSID/PSK/potência — mudança de plano)', () => {
    const params = huaweiWifiOptParams({
      cap: CAP_AX,
      profile: 'GIGA',
      regDomain: 'PY',
      ssid: 'Charles',
      psk: 'segredo123',
      mode: 'WIDTH_ONLY',
    });
    expect(params).toEqual([
      { name: HT20_5G, value: '4', type: 'xsd:unsignedInt' },
    ]);
  });

  it('modelo sem nó HT20 → lista vazia (caller não cria task)', () => {
    const params = huaweiWifiOptParams({
      cap: { ...CAP_V5, ht20: false },
      profile: 'BASE',
      regDomain: 'PY',
      ssid: 'Charles',
      psk: 'segredo123',
      mode: 'WIDTH_ONLY',
    });
    expect(params).toEqual([]);
  });
});

describe('huaweiWifiOptReadbackNames', () => {
  it('espelha o SET (variante global) + capability, SEM PSK', () => {
    const names = huaweiWifiOptReadbackNames(CAP_AX);
    expect(names).toContain(HUAWEI_EG8145_PATHS.ssid50);
    expect(names).toContain(HUAWEI_ROUTER_PATHS.bandSteeringPolicy);
    expect(names).toContain(HUAWEI_BAND_STEERING_CAPABILITY);
    expect(names).toContain(HT20_5G);
    expect(names).toContain(huaweiRegDomain(1));
    expect(names).toContain(huaweiRegDomain(5));
    expect(names).toContain(HUAWEI_TXPOWER_GLOBAL);
    expect(names).not.toContain(HUAWEI_EG8145_PATHS.pwd50);
    expect(names).not.toContain(huaweiWlanTxpower(1));
  });

  it('variante V5 plain lê TransmitPower por WLAN em vez do global', () => {
    const names = huaweiWifiOptReadbackNames(CAP_V5);
    expect(names).toContain(huaweiWlanTxpower(1));
    expect(names).toContain(huaweiWlanTxpower(5));
    expect(names).not.toContain(HUAWEI_TXPOWER_GLOBAL);
  });

  it('modelo sem nó HT20 não pede X_HW_HT20 (fault 9005 atômico)', () => {
    const names = huaweiWifiOptReadbackNames({ ...CAP_V5, ht20: false });
    expect(names).not.toContain(HT20_5G);
  });
});
