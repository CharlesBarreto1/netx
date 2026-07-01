import {
  ipToBigInt,
  bigIntToIp,
  normalizeIp,
  isValidIp,
  detectVersion,
  parseCidr,
  cidrContains,
  cidrsOverlap,
  addressCount,
  usableHostCount,
} from './ip.util';

describe('ip.util — IPv4', () => {
  it('converte IPv4 ↔ bigint', () => {
    expect(ipToBigInt('0.0.0.0')).toBe(0n);
    expect(ipToBigInt('255.255.255.255')).toBe(4294967295n);
    expect(ipToBigInt('192.168.0.1')).toBe(3232235521n);
    expect(bigIntToIp(3232235521n, 4)).toBe('192.168.0.1');
    expect(bigIntToIp(0n, 4)).toBe('0.0.0.0');
  });

  it('detecta versão', () => {
    expect(detectVersion('10.0.0.1')).toBe(4);
    expect(detectVersion('2001:db8::1')).toBe(6);
  });

  it('rejeita IPv4 inválido', () => {
    expect(isValidIp('256.0.0.1')).toBe(false);
    expect(isValidIp('1.2.3')).toBe(false);
    expect(isValidIp('a.b.c.d')).toBe(false);
  });

  it('parseia CIDR v4 normalizando a rede', () => {
    const c = parseCidr('10.0.0.5/24');
    expect(c.version).toBe(4);
    expect(c.prefixLen).toBe(24);
    expect(bigIntToIp(c.first, 4)).toBe('10.0.0.0');
    expect(bigIntToIp(c.last, 4)).toBe('10.0.0.255');
    expect(c.cidr).toBe('10.0.0.0/24');
  });

  it('/32 e /31', () => {
    const c32 = parseCidr('203.0.113.7/32');
    expect(c32.first).toBe(c32.last);
    expect(usableHostCount(4, 32)).toBe(1n);
    expect(usableHostCount(4, 31)).toBe(2n);
    expect(usableHostCount(4, 24)).toBe(254n);
  });

  it('addressCount v4', () => {
    expect(addressCount(4, 24)).toBe(256n);
    expect(addressCount(4, 8)).toBe(16777216n);
  });
});

describe('ip.util — IPv6', () => {
  it('expande :: e converte ↔ bigint', () => {
    expect(ipToBigInt('::1')).toBe(1n);
    expect(ipToBigInt('::')).toBe(0n);
    const full = ipToBigInt('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(ipToBigInt('2001:db8::1')).toBe(full);
  });

  it('normaliza pra forma canônica RFC 5952', () => {
    expect(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(normalizeIp('2001:db8:0:0:0:0:0:0')).toBe('2001:db8::');
    // comprime a MAIOR sequência de zeros
    expect(normalizeIp('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1');
  });

  it('IPv4 embutido', () => {
    expect(ipToBigInt('::ffff:192.168.0.1')).toBe(ipToBigInt('::ffff:c0a8:1'));
  });

  it('parseia CIDR v6', () => {
    const c = parseCidr('2001:db8:abcd:1234::/64');
    expect(c.version).toBe(6);
    expect(bigIntToIp(c.first, 6)).toBe('2001:db8:abcd:1234::');
    expect(addressCount(6, 64)).toBe(1n << 64n);
  });

  it('rejeita IPv6 inválido', () => {
    expect(isValidIp('2001:db8::g')).toBe(false);
    expect(isValidIp('1::2::3')).toBe(false);
  });
});

describe('ip.util — containment & overlap', () => {
  it('cidrContains', () => {
    const outer = parseCidr('10.0.0.0/8');
    const inner = parseCidr('10.1.2.0/24');
    expect(cidrContains(outer, inner)).toBe(true);
    expect(cidrContains(inner, outer)).toBe(false);
  });

  it('cidrsOverlap detecta cruzamento e aninhamento', () => {
    expect(cidrsOverlap(parseCidr('10.0.0.0/24'), parseCidr('10.0.0.128/25'))).toBe(true);
    expect(cidrsOverlap(parseCidr('10.0.0.0/24'), parseCidr('10.0.1.0/24'))).toBe(false);
    // versões diferentes nunca se sobrepõem
    expect(cidrsOverlap(parseCidr('10.0.0.0/24'), parseCidr('2001:db8::/32'))).toBe(false);
  });
});
