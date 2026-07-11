/**
 * WiFi-Opt — testes da lógica pura de capability/profile/largura.
 *
 * Trava as regras de negócio ANTES do service existir: GIGA só com AX e
 * >800 Mbps; BASE fixa 80 MHz ('3') em AX E AC (correção empírica — auto '0'
 * negocia só 40 MHz na prática e nunca entra no pacote); capability
 * desconhecida → skip (null).
 */
import {
  GIGA_THRESHOLD_MBPS,
  huaweiWifiCapabilityFor,
  isDfsChannel,
  resolveWifiOptProfile,
  widthCodeFor,
  type HuaweiWifiCapability,
} from './wifi-opt.resolver';

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

describe('huaweiWifiCapabilityFor — matcher por productClass', () => {
  it('EG8145X6/X10 → AX, Txpower global, teto 160MHz', () => {
    for (const pc of ['EG8145X6', 'EG8145X10']) {
      expect(huaweiWifiCapabilityFor(pc)).toEqual({
        ax: true,
        txpower: 'X_HW_TXPOWER',
        maxWidthCode: '4',
        ht20: true,
      });
    }
  });

  it('EG8145V5-V2 → AC com Txpower global, teto 80MHz', () => {
    expect(huaweiWifiCapabilityFor('EG8145V5-V2')).toEqual({
      ax: false,
      txpower: 'X_HW_TXPOWER',
      maxWidthCode: '3',
      ht20: true,
    });
  });

  it('EG8145V5 plain → AC com TransmitPower por WLAN, teto 80MHz', () => {
    expect(huaweiWifiCapabilityFor('EG8145V5')).toEqual({
      ax: false,
      txpower: 'WLAN_TRANSMIT_POWER',
      maxWidthCode: '3',
      ht20: true,
    });
  });

  it('casa case-insensitive (device reporta variações)', () => {
    expect(huaweiWifiCapabilityFor('eg8145x6')?.ax).toBe(true);
    expect(huaweiWifiCapabilityFor('eg8145v5')?.ax).toBe(false);
  });

  it('desconhecido/null/vazio → null (skip — nunca chutar params)', () => {
    expect(huaweiWifiCapabilityFor('HG8546M')).toBeNull();
    expect(huaweiWifiCapabilityFor(null)).toBeNull();
    expect(huaweiWifiCapabilityFor(undefined)).toBeNull();
    expect(huaweiWifiCapabilityFor('')).toBeNull();
  });
});

describe('resolveWifiOptProfile — trava do GIGA', () => {
  it('800 Mbps (borda) → BASE mesmo em AX', () => {
    expect(resolveWifiOptProfile(GIGA_THRESHOLD_MBPS, CAP_AX)).toBe('BASE');
  });

  it('801 Mbps + AX → GIGA', () => {
    expect(resolveWifiOptProfile(801, CAP_AX)).toBe('GIGA');
  });

  it('2000 Mbps + V5 (sem AX) → BASE por construção', () => {
    expect(resolveWifiOptProfile(2000, CAP_V5)).toBe('BASE');
  });

  it('2000 Mbps + capability null → BASE', () => {
    expect(resolveWifiOptProfile(2000, null)).toBe('BASE');
  });

  it('bandwidth null/undefined → BASE', () => {
    expect(resolveWifiOptProfile(null, CAP_AX)).toBe('BASE');
    expect(resolveWifiOptProfile(undefined, CAP_AX)).toBe('BASE');
  });
});

describe('widthCodeFor — largura fixa, nunca auto', () => {
  it("GIGA → '4' (160MHz fixo)", () => {
    expect(widthCodeFor('GIGA', CAP_AX)).toBe('4');
  });

  it("BASE + AX → '3' (80MHz fixo)", () => {
    expect(widthCodeFor('BASE', CAP_AX)).toBe('3');
  });

  it("BASE + AC → '3' também (correção empírica — '0' auto negocia só 40MHz)", () => {
    expect(widthCodeFor('BASE', CAP_V5)).toBe('3');
  });

  it('capability null ou sem nó HT20 → null (não tocar largura)', () => {
    expect(widthCodeFor('BASE', null)).toBeNull();
    expect(widthCodeFor('GIGA', { ...CAP_AX, ht20: false })).toBeNull();
  });
});

describe('isDfsChannel — bandas UNII-2/UNII-2e', () => {
  it('bordas 52 e 144 são DFS', () => {
    expect(isDfsChannel(52)).toBe(true);
    expect(isDfsChannel(144)).toBe(true);
    expect(isDfsChannel(100)).toBe(true);
  });

  it('fora do range não é DFS', () => {
    expect(isDfsChannel(36)).toBe(false);
    expect(isDfsChannel(48)).toBe(false);
    expect(isDfsChannel(149)).toBe(false);
    expect(isDfsChannel(161)).toBe(false);
  });
});
