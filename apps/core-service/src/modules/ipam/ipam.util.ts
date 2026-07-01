import { Prisma } from '@prisma/client';

import { IpVer } from './ip.util';

/**
 * Helpers de conversão entre o `Decimal` do Prisma (coluna numeric(40,0)) e o
 * `bigint` que usamos na matemática de IP. IMPORTANTE: `Decimal.toString()` do
 * decimal.js pode sair em notação exponencial pra números >= 1e21 (todo IPv6
 * grande), o que quebra `BigInt()`. Por isso usamos `toFixed(0)`, que sempre
 * devolve a forma inteira plena.
 */

/** Decimal do Prisma → bigint. */
export function toBig(d: Prisma.Decimal | null | undefined): bigint {
  if (d == null) return 0n;
  return BigInt(d.toFixed(0));
}

/** bigint → string aceita como input de coluna Decimal no Prisma. */
export function toDec(n: bigint): string {
  return n.toString();
}

/** Enum de versão do Prisma ('V4'|'V6') → número (4|6). */
export function verToNum(v: 'V4' | 'V6'): IpVer {
  return v === 'V4' ? 4 : 6;
}

/** Número (4|6) → enum de versão do Prisma. */
export function numToVer(v: IpVer): 'V4' | 'V6' {
  return v === 4 ? 'V4' : 'V6';
}
