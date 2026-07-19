import { ipToBigInt, parseCidr } from './ip.util';
import {
  diffObservations,
  tightestPrefix,
  type DocumentedAddress,
  type Observation,
  type ObservationSource,
  type PrefixRange,
} from './reconcile.types';

const px = (cidr: string, id = cidr): PrefixRange => {
  const p = parseCidr(cidr);
  return { id, cidr: p.cidr, version: p.version, first: p.first, last: p.last };
};

const obs = (ip: string, source: ObservationSource, extra: Partial<Observation> = {}): Observation => ({
  ip,
  num: ipToBigInt(ip),
  version: ip.includes(':') ? 6 : 4,
  source,
  ...extra,
});

const doc = (ip: string, extra: Partial<DocumentedAddress> = {}): DocumentedAddress => ({
  id: `addr-${ip}`,
  num: ipToBigInt(ip),
  version: ip.includes(':') ? 6 : 4,
  address: ip,
  status: 'USED',
  contractId: null,
  customerId: null,
  equipmentId: null,
  ...extra,
});

const run = (o: Observation[], d: DocumentedAddress[], p: PrefixRange[], dead: string[] = []) =>
  diffObservations({
    observations: o,
    documented: d,
    prefixes: p,
    deadContractIds: new Set(dead),
  });

describe('tightestPrefix', () => {
  it('escolhe o prefixo mais específico que contém o IP', () => {
    const p = [px('10.0.0.0/8'), px('10.0.0.0/16'), px('10.0.0.0/24')];
    expect(tightestPrefix(p, ipToBigInt('10.0.0.5'), 4)?.cidr).toBe('10.0.0.0/24');
    expect(tightestPrefix(p, ipToBigInt('10.0.5.5'), 4)?.cidr).toBe('10.0.0.0/16');
    expect(tightestPrefix(p, ipToBigInt('10.5.0.5'), 4)?.cidr).toBe('10.0.0.0/8');
  });

  it('não cruza versões', () => {
    expect(tightestPrefix([px('10.0.0.0/8')], ipToBigInt('2001:db8::1'), 6)).toBeNull();
  });

  it('devolve null fora de qualquer prefixo', () => {
    expect(tightestPrefix([px('10.0.0.0/8')], ipToBigInt('192.168.0.1'), 4)).toBeNull();
  });
});

describe('UNDOCUMENTED', () => {
  it('aponta IP em uso na rede e ausente do IPAM', () => {
    const f = run([obs('10.0.0.5', 'RADIUS', { contractId: 'c1' })], [], [px('10.0.0.0/24')]);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('UNDOCUMENTED');
    expect(f[0].prefixCidr).toBe('10.0.0.0/24');
    expect(f[0].observedContractId).toBe('c1');
  });

  it('não aponta nada quando o IP já está documentado com o mesmo dono', () => {
    const f = run(
      [obs('10.0.0.5', 'RADIUS', { contractId: 'c1' })],
      [doc('10.0.0.5', { contractId: 'c1' })],
      [px('10.0.0.0/24')],
    );
    expect(f).toEqual([]);
  });

  it('funde várias fontes que veem o mesmo IP num único achado', () => {
    const f = run(
      [
        obs('10.0.0.5', 'MIKROTIK_ARP', { macAddress: 'AA:BB:CC:DD:EE:FF' }),
        obs('10.0.0.5', 'RADIUS', { contractId: 'c1' }),
      ],
      [],
      [px('10.0.0.0/24')],
    );
    expect(f).toHaveLength(1);
    expect(f[0].sources).toEqual(['MIKROTIK_ARP', 'RADIUS']);
    // ARP não sabe de quem é o IP; RADIUS sabe. O dono vem do RADIUS,
    // o MAC vem do ARP.
    expect(f[0].observedContractId).toBe('c1');
    expect(f[0].macAddress).toBe('AA:BB:CC:DD:EE:FF');
  });
});

describe('NO_PREFIX', () => {
  it('aponta IP em uso fora de qualquer prefixo documentado', () => {
    const f = run([obs('192.168.9.9', 'MIKROTIK_ARP')], [], [px('10.0.0.0/8')]);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('NO_PREFIX');
    expect(f[0].prefixId).toBeNull();
  });

  it('NO_PREFIX tem precedência sobre UNDOCUMENTED', () => {
    // Sem prefixo não há onde documentar — apontar "importe" seria inútil.
    const f = run([obs('192.168.9.9', 'RADIUS', { contractId: 'c1' })], [], []);
    expect(f.map((x) => x.kind)).toEqual(['NO_PREFIX']);
  });
});

describe('OWNER_MISMATCH', () => {
  it('acusa quando IPAM e rede discordam do contrato dono', () => {
    const f = run(
      [obs('10.0.0.5', 'RADIUS', { contractId: 'c2' })],
      [doc('10.0.0.5', { contractId: 'c1' })],
      [px('10.0.0.0/24')],
    );
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('OWNER_MISMATCH');
    expect(f[0].addressId).toBe('addr-10.0.0.5');
  });

  it('não acusa quando a fonte não sabe de quem é o IP', () => {
    // ARP prova que o IP está vivo, não a quem pertence — não dá pra
    // contradizer o cadastro com base nisso.
    const f = run(
      [obs('10.0.0.5', 'MIKROTIK_ARP', { macAddress: 'AA:BB:CC:DD:EE:FF' })],
      [doc('10.0.0.5', { contractId: 'c1' })],
      [px('10.0.0.0/24')],
    );
    expect(f).toEqual([]);
  });

  it('acusa divergência de equipamento também', () => {
    const f = run(
      [obs('10.0.0.1', 'EQUIPMENT', { equipmentId: 'e2' })],
      [doc('10.0.0.1', { equipmentId: 'e1' })],
      [px('10.0.0.0/24')],
    );
    expect(f[0].kind).toBe('OWNER_MISMATCH');
  });
});

describe('ORPHANED', () => {
  it('aponta documentado preso a contrato cancelado', () => {
    const f = run([], [doc('10.0.0.9', { contractId: 'morto' })], [px('10.0.0.0/24')], ['morto']);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('ORPHANED');
    expect(f[0].addressId).toBe('addr-10.0.0.9');
  });

  it('NÃO marca como órfão só porque o IP não apareceu na varredura', () => {
    // Cliente offline no instante do scan segue com o IP reservado. Tratar
    // ausência como prova de desuso faria o operador liberar IP em uso.
    const f = run([], [doc('10.0.0.9', { contractId: 'vivo' })], [px('10.0.0.0/24')], []);
    expect(f).toEqual([]);
  });
});

describe('ordenação e escopo', () => {
  it('agrupa por tipo na ordem de prioridade operacional', () => {
    const f = run(
      [
        obs('10.0.0.5', 'RADIUS', { contractId: 'c2' }),
        obs('10.0.0.7', 'RADIUS', { contractId: 'c3' }),
        obs('192.168.1.1', 'MIKROTIK_ARP'),
      ],
      [doc('10.0.0.5', { contractId: 'c1' }), doc('10.0.0.8', { contractId: 'morto' })],
      [px('10.0.0.0/24')],
      ['morto'],
    );
    expect(f.map((x) => x.kind)).toEqual([
      'UNDOCUMENTED',
      'NO_PREFIX',
      'OWNER_MISMATCH',
      'ORPHANED',
    ]);
  });

  it('trata IPv6 sem cruzar com IPv4 de mesmo valor numérico', () => {
    const f = run(
      [obs('2001:db8::1', 'RADIUS', { contractId: 'c1' })],
      [doc('10.0.0.5', { contractId: 'c1' })],
      [px('2001:db8::/32'), px('10.0.0.0/24')],
    );
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('UNDOCUMENTED');
    expect(f[0].version).toBe(6);
  });
});
