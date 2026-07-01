import { ipToBigInt, bigIntToIp } from './ip.util';
import {
  CgnatParams,
  blocksPerPublicIp,
  capacity,
  mapPrivate,
  reverseLookup,
  iterate,
  assertParams,
} from './cgnat.algo';

// 1 IP público, portas 1024..65535, 1000 portas/cliente → 64 blocos.
function baseParams(overrides: Partial<CgnatParams> = {}): CgnatParams {
  return {
    publicFirst: ipToBigInt('203.0.113.1'),
    publicLast: ipToBigInt('203.0.113.1'),
    cgnatFirst: ipToBigInt('100.64.0.0'),
    cgnatLast: ipToBigInt('100.64.0.63'), // 64 IPs = exatamente a capacidade
    portsPerClient: 1000,
    portBase: 1024,
    maxPort: 65535,
    ...overrides,
  };
}

describe('cgnat.algo — capacidade', () => {
  it('blocos por IP público', () => {
    expect(blocksPerPublicIp(baseParams())).toBe(64);
  });

  it('capacidade suficiente quando cgnatCount == capacity', () => {
    const c = capacity(baseParams());
    expect(c.capacity).toBe(64n);
    expect(c.cgnatCount).toBe(64n);
    expect(c.sufficient).toBe(true);
    expect(c.spare).toBe(0n);
  });

  it('detecta capacidade insuficiente', () => {
    const c = capacity(baseParams({ cgnatLast: ipToBigInt('100.64.0.255') })); // 256 privados
    expect(c.sufficient).toBe(false);
    expect(c.spare).toBe(64n - 256n);
  });
});

describe('cgnat.algo — mapeamento determinístico', () => {
  it('primeiro IP privado → slot 0', () => {
    const m = mapPrivate(ipToBigInt('100.64.0.0'), baseParams());
    expect(bigIntToIp(m.publicNum, 4)).toBe('203.0.113.1');
    expect(m.portStart).toBe(1024);
    expect(m.portEnd).toBe(2023);
  });

  it('IP privado i=1 → próximo bloco de portas', () => {
    const m = mapPrivate(ipToBigInt('100.64.0.1'), baseParams());
    expect(m.portStart).toBe(2024);
    expect(m.portEnd).toBe(3023);
  });

  it('último slot do IP público', () => {
    const m = mapPrivate(ipToBigInt('100.64.0.63'), baseParams());
    expect(m.portStart).toBe(1024 + 63 * 1000);
    expect(m.portEnd).toBe(65023);
  });

  it('é determinístico (mesma entrada, mesma saída)', () => {
    const a = mapPrivate(ipToBigInt('100.64.0.42'), baseParams());
    const b = mapPrivate(ipToBigInt('100.64.0.42'), baseParams());
    expect(a).toEqual(b);
  });

  it('avança pro 2º IP público quando o 1º enche', () => {
    const p = baseParams({
      publicLast: ipToBigInt('203.0.113.2'), // 2 IPs públicos
      cgnatLast: ipToBigInt('100.64.0.127'),
    });
    const m = mapPrivate(ipToBigInt('100.64.0.64'), p); // i=64 → publicIndex 1, slot 0
    expect(bigIntToIp(m.publicNum, 4)).toBe('203.0.113.2');
    expect(m.portStart).toBe(1024);
  });

  it('lança fora do bloco CGNAT', () => {
    expect(() => mapPrivate(ipToBigInt('10.0.0.1'), baseParams())).toThrow();
  });
});

describe('cgnat.algo — busca reversa (inversa do mapeamento)', () => {
  it('IP público + porta → IP privado correto', () => {
    const p = baseParams();
    const priv = reverseLookup(ipToBigInt('203.0.113.1'), 1500, p);
    expect(priv).not.toBeNull();
    expect(bigIntToIp(priv as bigint, 4)).toBe('100.64.0.0');
  });

  it('reverso bate com o direto pra todos os IPs (round-trip)', () => {
    const p = baseParams();
    for (let i = 0n; i < 64n; i++) {
      const privNum = p.cgnatFirst + i;
      const m = mapPrivate(privNum, p);
      const mid = Math.floor((m.portStart + m.portEnd) / 2);
      expect(reverseLookup(m.publicNum, mid, p)).toBe(privNum);
      // bordas do bloco
      expect(reverseLookup(m.publicNum, m.portStart, p)).toBe(privNum);
      expect(reverseLookup(m.publicNum, m.portEnd, p)).toBe(privNum);
    }
  });

  it('porta na sobra acima do último bloco → null', () => {
    const p = baseParams();
    // último bloco termina em 65023; 65024..65535 é sobra não alocada
    expect(reverseLookup(ipToBigInt('203.0.113.1'), 65024, p)).toBeNull();
  });

  it('porta abaixo de portBase → null', () => {
    expect(reverseLookup(ipToBigInt('203.0.113.1'), 80, baseParams())).toBeNull();
  });

  it('IP público fora do bloco → null', () => {
    expect(reverseLookup(ipToBigInt('8.8.8.8'), 1500, baseParams())).toBeNull();
  });
});

describe('cgnat.algo — iterate', () => {
  it('gera exatamente cgnatCount entradas quando suficiente', () => {
    const entries = [...iterate(baseParams())];
    expect(entries.length).toBe(64);
    expect(bigIntToIp(entries[0].privateNum, 4)).toBe('100.64.0.0');
    expect(bigIntToIp(entries[63].privateNum, 4)).toBe('100.64.0.63');
  });

  it('limita à capacidade quando insuficiente', () => {
    const entries = [...iterate(baseParams({ cgnatLast: ipToBigInt('100.64.0.255') }))];
    expect(entries.length).toBe(64); // capacity, não 256
  });
});

describe('cgnat.algo — validação de parâmetros', () => {
  it('rejeita portsPerClient maior que a faixa', () => {
    expect(() => assertParams(baseParams({ portsPerClient: 70000 }))).toThrow();
  });
  it('rejeita maxPort < portBase', () => {
    expect(() => assertParams(baseParams({ portBase: 5000, maxPort: 1000 }))).toThrow();
  });
});
