/**
 * Utilitário de endereçamento IP — IPv4 E IPv6 de forma uniforme.
 *
 * Toda a matemática é feita em `bigint`: um IPv4 vira um inteiro de 32 bits, um
 * IPv6 um inteiro de 128 bits. Como `bigint` é arbitrário, a MESMA função de
 * overlap/containment/next-free serve pras duas versões. Persistimos esses
 * inteiros como `numeric(40,0)` (Decimal do Prisma) — 10^40 > 2^128.
 *
 * Sem dependências externas (proposital: `ipaddr.js` não cobre bigint e a
 * lógica de CGNAT precisa de inteiros grandes exatos).
 */

export type IpVer = 4 | 6;

const V4_BITS = 32n;
const V6_BITS = 128n;
export const V4_MAX = (1n << V4_BITS) - 1n;
export const V6_MAX = (1n << V6_BITS) - 1n;

export interface ParsedCidr {
  version: IpVer;
  prefixLen: number;
  /** Primeiro endereço do bloco (network), inclusive. */
  first: bigint;
  /** Último endereço do bloco (broadcast em v4), inclusive. */
  last: bigint;
  /** CIDR canônico normalizado (rede/len), ex.: "10.0.0.0/24". */
  cidr: string;
}

/** Detecta versão pelo formato (presença de ':' = IPv6). */
export function detectVersion(ip: string): IpVer {
  return ip.includes(':') ? 6 : 4;
}

/** Converte um IPv4 em bigint (32 bits). Lança se inválido. */
function v4ToBigInt(ip: string): bigint {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`IPv4 inválido: ${ip}`);
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) throw new Error(`IPv4 inválido: ${ip}`);
    const octet = Number(p);
    if (octet > 255) throw new Error(`IPv4 inválido: ${ip}`);
    n = (n << 8n) | BigInt(octet);
  }
  return n;
}

/** Converte um IPv6 (com suporte a `::` e IPv4 embutido) em bigint (128 bits). */
function v6ToBigInt(ip: string): bigint {
  let addr = ip.trim();
  // Remove zona de escopo (ex.: fe80::1%eth0) — irrelevante pra numérico.
  const pct = addr.indexOf('%');
  if (pct >= 0) addr = addr.slice(0, pct);

  const dbl = addr.split('::');
  if (dbl.length > 2) throw new Error(`IPv6 inválido: ${ip}`);

  const expand = (segment: string): bigint[] => {
    if (segment === '') return [];
    const groups: bigint[] = [];
    for (const g of segment.split(':')) {
      if (g.includes('.')) {
        // IPv4 embutido nos últimos 32 bits (ex.: ::ffff:192.168.0.1)
        const v4 = v4ToBigInt(g);
        groups.push((v4 >> 16n) & 0xffffn, v4 & 0xffffn);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new Error(`IPv6 inválido: ${ip}`);
        groups.push(BigInt(parseInt(g, 16)));
      }
    }
    return groups;
  };

  const head = expand(dbl[0]);
  const tail = dbl.length === 2 ? expand(dbl[1]) : null;

  let groups: bigint[];
  if (tail === null) {
    groups = head;
    if (groups.length !== 8) throw new Error(`IPv6 inválido: ${ip}`);
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) throw new Error(`IPv6 inválido: ${ip}`);
    groups = [...head, ...Array<bigint>(missing).fill(0n), ...tail];
  }

  let n = 0n;
  for (const g of groups) n = (n << 16n) | g;
  return n;
}

/** IP (v4 ou v6) → bigint. */
export function ipToBigInt(ip: string): bigint {
  return detectVersion(ip) === 4 ? v4ToBigInt(ip) : v6ToBigInt(ip);
}

/** bigint → IPv4 pontilhado. */
function bigIntToV4(n: bigint): string {
  if (n < 0n || n > V4_MAX) throw new Error(`fora do range IPv4: ${n}`);
  return [
    (n >> 24n) & 0xffn,
    (n >> 16n) & 0xffn,
    (n >> 8n) & 0xffn,
    n & 0xffn,
  ].join('.');
}

/** bigint → IPv6 canônico (RFC 5952: minúsculo, sem zeros à esquerda, `::` na
 *  maior sequência de zeros, a mais à esquerda em caso de empate). */
function bigIntToV6(n: bigint): string {
  if (n < 0n || n > V6_MAX) throw new Error(`fora do range IPv6: ${n}`);
  const groups: number[] = [];
  for (let i = 0; i < 8; i++) {
    groups.unshift(Number(n & 0xffffn));
    n >>= 16n;
  }
  // Acha a maior sequência de zeros (comprimento >= 2) pra comprimir.
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

/** bigint → IP na versão dada. */
export function bigIntToIp(n: bigint, version: IpVer): string {
  return version === 4 ? bigIntToV4(n) : bigIntToV6(n);
}

/** Normaliza um IP pra forma canônica (ex.: "2001:DB8::0001" → "2001:db8::1"). */
export function normalizeIp(ip: string): string {
  const v = detectVersion(ip);
  return bigIntToIp(ipToBigInt(ip), v);
}

/** Valida um IP (v4 ou v6). */
export function isValidIp(ip: string): boolean {
  try {
    ipToBigInt(ip);
    return true;
  } catch {
    return false;
  }
}

/** Máscara de host (bits baixos setados) pra `hostBits`. */
function hostMask(hostBits: bigint): bigint {
  return hostBits <= 0n ? 0n : (1n << hostBits) - 1n;
}

/**
 * Parseia um CIDR (v4 ou v6). Aceita entrada não-normalizada (ex.:
 * "10.0.0.5/24" → rede 10.0.0.0/24). Lança em prefixo/IP inválido.
 */
export function parseCidr(input: string): ParsedCidr {
  const slash = input.indexOf('/');
  if (slash < 0) throw new Error(`CIDR sem prefixo: ${input}`);
  const ipPart = input.slice(0, slash).trim();
  const lenPart = input.slice(slash + 1).trim();
  if (!/^\d{1,3}$/.test(lenPart)) throw new Error(`prefixo inválido: ${input}`);

  const version = detectVersion(ipPart);
  const totalBits = version === 4 ? 32 : 128;
  const prefixLen = Number(lenPart);
  if (prefixLen < 0 || prefixLen > totalBits) throw new Error(`prefixo fora do range: ${input}`);

  const ipNum = ipToBigInt(ipPart);
  const hostBits = BigInt(totalBits - prefixLen);
  const first = (ipNum >> hostBits) << hostBits; // zera os bits de host
  const last = first | hostMask(hostBits);

  return {
    version,
    prefixLen,
    first,
    last,
    cidr: `${bigIntToIp(first, version)}/${prefixLen}`,
  };
}

/** Nº de endereços num prefixo (2^hostBits). Cuidado: enorme p/ v6. */
export function addressCount(version: IpVer, prefixLen: number): bigint {
  const totalBits = version === 4 ? 32 : 128;
  return 1n << BigInt(totalBits - prefixLen);
}

/** `inner` está totalmente contido em `outer` (mesma versão)? */
export function cidrContains(outer: ParsedCidr, inner: ParsedCidr): boolean {
  return (
    outer.version === inner.version &&
    inner.first >= outer.first &&
    inner.last <= outer.last
  );
}

/** Dois ranges [aFirst,aLast] e [bFirst,bLast] se sobrepõem? */
export function rangesOverlap(
  aFirst: bigint,
  aLast: bigint,
  bFirst: bigint,
  bLast: bigint,
): boolean {
  return aFirst <= bLast && bFirst <= aLast;
}

/** Dois prefixos se sobrepõem (um contém o outro ou cruzam)? */
export function cidrsOverlap(a: ParsedCidr, b: ParsedCidr): boolean {
  return a.version === b.version && rangesOverlap(a.first, a.last, b.first, b.last);
}

/**
 * Endereços "utilizáveis" pra hosts num prefixo — desconta network+broadcast
 * em IPv4 /0../30 (convenção). Em /31 e /32 (e todo IPv6) conta tudo.
 */
export function usableHostCount(version: IpVer, prefixLen: number): bigint {
  const total = addressCount(version, prefixLen);
  if (version === 4 && prefixLen <= 30) return total - 2n;
  return total;
}
