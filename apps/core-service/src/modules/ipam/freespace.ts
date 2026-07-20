import { bigIntToIp, type IpVer } from './ip.util';

/**
 * Cálculo de espaço LIVRE dentro de um prefixo — o que falta pra responder
 * "qual a próxima subrede disponível?".
 *
 * A ideia: um prefixo pai cobre o range contínuo [first,last]. Os filhos diretos
 * ocupam sub-ranges disjuntos (blocos CIDR nunca se sobrepõem parcialmente — ou
 * são disjuntos, ou um contém o outro; e irmãos, por definição, são disjuntos).
 * Logo o espaço livre é o complemento: varremos os filhos em ordem e o que
 * sobra entre eles são os buracos.
 *
 * Um buraco é um range arbitrário e nem sempre é um CIDR único — ex.: o buraco
 * 10.0.0.1–10.0.0.6 vira 10.0.0.1/32 + 10.0.0.2/31 + 10.0.0.4/30. Por isso cada
 * buraco é decomposto no menor conjunto de blocos CIDR alinhados que o cobre.
 *
 * Tudo em `bigint`, então IPv4 e IPv6 usam exatamente o mesmo código.
 */

/** Range inclusivo [first,last] já em forma numérica. */
export interface NumRange {
  first: bigint;
  last: bigint;
}

/** Bloco CIDR livre, alinhado e inteiramente dentro do pai. */
export interface FreeBlock {
  cidr: string;
  prefixLen: number;
  first: bigint;
  last: bigint;
  /** Nº de endereços do bloco (2^hostBits). */
  size: bigint;
}

export interface FreeSpace {
  blocks: FreeBlock[];
  /** Soma dos endereços livres, mesmo se `blocks` foi truncado. */
  totalFree: bigint;
  /** `true` se o nº de blocos estourou o limite e a lista foi cortada. */
  truncated: boolean;
}

const bitsOf = (version: IpVer): number => (version === 4 ? 32 : 128);

/**
 * Maior expoente `e` tal que 2^e divide `n` — ou seja, o alinhamento de `n`.
 * Para n = 0 todo expoente serve, então devolvemos o teto (`cap`).
 */
function trailingZeros(n: bigint, cap: number): number {
  if (n === 0n) return cap;
  let e = 0;
  let v = n;
  while ((v & 1n) === 0n) {
    v >>= 1n;
    e++;
  }
  return e;
}

/** floor(log2(n)) para n >= 1. */
function floorLog2(n: bigint): number {
  let e = -1;
  let v = n;
  while (v > 0n) {
    v >>= 1n;
    e++;
  }
  return e;
}

/**
 * Decompõe o range [first,last] no MENOR conjunto de blocos CIDR alinhados.
 *
 * A cada passo pegamos o maior bloco que (a) começa em `a` respeitando o
 * alinhamento natural de `a` e (b) não passa de `last`. Esse é o algoritmo
 * clássico de range→CIDR e é ótimo: nenhum bloco maior caberia sem violar
 * alinhamento ou transbordar.
 */
export function rangeToCidrs(
  first: bigint,
  last: bigint,
  version: IpVer,
  limit = Number.POSITIVE_INFINITY,
): { blocks: FreeBlock[]; truncated: boolean } {
  const totalBits = bitsOf(version);
  const blocks: FreeBlock[] = [];
  let a = first;

  while (a <= last) {
    if (blocks.length >= limit) return { blocks, truncated: true };
    // Alinhamento de `a` limita o tamanho; o que resta até `last` também.
    const hostBits = Math.min(trailingZeros(a, totalBits), floorLog2(last - a + 1n));
    const size = 1n << BigInt(hostBits);
    const prefixLen = totalBits - hostBits;
    blocks.push({
      cidr: `${bigIntToIp(a, version)}/${prefixLen}`,
      prefixLen,
      first: a,
      last: a + size - 1n,
      size,
    });
    a += size;
  }

  return { blocks, truncated: false };
}

/**
 * Buracos (ranges livres) de `parent` depois de descontar `occupied`.
 * `occupied` pode vir em qualquer ordem; ranges fora do pai são ignorados e
 * sobreposições entre eles são toleradas (fundidas).
 */
export function freeRanges(parent: NumRange, occupied: NumRange[]): NumRange[] {
  const inside = occupied
    .filter((o) => o.last >= parent.first && o.first <= parent.last)
    .map((o) => ({
      first: o.first < parent.first ? parent.first : o.first,
      last: o.last > parent.last ? parent.last : o.last,
    }))
    .sort((x, y) => (x.first < y.first ? -1 : x.first > y.first ? 1 : 0));

  const gaps: NumRange[] = [];
  let cursor = parent.first;

  for (const o of inside) {
    if (o.first > cursor) gaps.push({ first: cursor, last: o.first - 1n });
    // `cursor` só anda pra frente: filhos aninhados/repetidos não retrocedem.
    if (o.last + 1n > cursor) cursor = o.last + 1n;
  }
  if (cursor <= parent.last) gaps.push({ first: cursor, last: parent.last });

  return gaps;
}

/** Espaço livre de um prefixo, já decomposto em blocos CIDR alinhados. */
export function freeSpace(
  parent: NumRange,
  occupied: NumRange[],
  version: IpVer,
  limit = 256,
): FreeSpace {
  const gaps = freeRanges(parent, occupied);
  const blocks: FreeBlock[] = [];
  let totalFree = 0n;
  let truncated = false;

  for (const g of gaps) {
    totalFree += g.last - g.first + 1n;
    if (truncated) continue;
    const r = rangeToCidrs(g.first, g.last, version, limit - blocks.length);
    blocks.push(...r.blocks);
    if (r.truncated) truncated = true;
  }

  return { blocks, totalFree, truncated };
}

/**
 * Primeira subrede livre de tamanho `/prefixLen` (first-fit, endereço mais
 * baixo). Devolve `null` se não couber em nenhum buraco.
 *
 * Não basta procurar um buraco grande o bastante: o bloco precisa começar num
 * múltiplo do seu tamanho. Num buraco 10.0.0.128–10.0.1.255 não existe /23,
 * mesmo havendo 384 endereços livres, porque o único /23 alinhado ali começaria
 * em 10.0.0.0 — que está ocupado.
 */
export function firstFreeSubnet(
  parent: NumRange,
  occupied: NumRange[],
  version: IpVer,
  prefixLen: number,
): FreeBlock | null {
  const totalBits = bitsOf(version);
  if (prefixLen < 0 || prefixLen > totalBits) return null;

  const size = 1n << BigInt(totalBits - prefixLen);

  for (const g of freeRanges(parent, occupied)) {
    // Sobe `g.first` até o próximo múltiplo de `size`.
    const start = ((g.first + size - 1n) / size) * size;
    if (start + size - 1n <= g.last) {
      return {
        cidr: `${bigIntToIp(start, version)}/${prefixLen}`,
        prefixLen,
        first: start,
        last: start + size - 1n,
        size,
      };
    }
  }
  return null;
}

/**
 * Fatia `parent` inteiro em blocos consecutivos de `/prefixLen`, pulando o que
 * já estiver ocupado. Usado pelo "dividir prefixo" da UI.
 */
export function splitIntoSubnets(
  parent: NumRange,
  occupied: NumRange[],
  version: IpVer,
  prefixLen: number,
  limit = 1024,
): { blocks: FreeBlock[]; truncated: boolean } {
  const totalBits = bitsOf(version);
  if (prefixLen < 0 || prefixLen > totalBits) return { blocks: [], truncated: false };

  const size = 1n << BigInt(totalBits - prefixLen);
  const blocks: FreeBlock[] = [];

  for (const g of freeRanges(parent, occupied)) {
    let start = ((g.first + size - 1n) / size) * size;
    while (start + size - 1n <= g.last) {
      if (blocks.length >= limit) return { blocks, truncated: true };
      blocks.push({
        cidr: `${bigIntToIp(start, version)}/${prefixLen}`,
        prefixLen,
        first: start,
        last: start + size - 1n,
        size,
      });
      start += size;
    }
  }

  return { blocks, truncated: false };
}
